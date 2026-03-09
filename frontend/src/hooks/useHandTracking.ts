import { useEffect, useRef, useState, useCallback } from 'react';

// MediaPipe types
declare const Hands: new (config: { locateFile: (file: string) => string }) => MediaPipeHands;
declare const Camera: new (video: HTMLVideoElement, config: { onFrame: () => Promise<void>; width: number; height: number }) => MediaPipeCamera;

interface MediaPipeHands {
  setOptions: (options: object) => void;
  onResults: (callback: (results: HandResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
}

interface MediaPipeCamera {
  start: () => void;
  stop: () => void;
}

interface HandResults {
  multiHandLandmarks?: { x: number; y: number; z: number }[][];
  multiHandedness?: { label: string }[];
}

interface HandPosition {
  x: number;
  y: number;
  confidence: number;
}

type Gesture = 'open' | 'fist' | 'point' | 'peace' | null;

// Detect gesture from landmarks
function detectGesture(landmarks: { x: number; y: number; z: number }[]): Gesture {
  // Landmark indices:
  // Thumb: 1-4 (tip=4), Index: 5-8 (tip=8), Middle: 9-12 (tip=12)
  // Ring: 13-16 (tip=16), Pinky: 17-20 (tip=20)
  // MCP (knuckle) = base+1: Index MCP=5, Middle MCP=9, Ring MCP=13, Pinky MCP=17

  const indexTip = landmarks[8];
  const indexMcp = landmarks[5];
  const middleTip = landmarks[12];
  const middleMcp = landmarks[9];
  const ringTip = landmarks[16];
  const ringMcp = landmarks[13];
  const pinkyTip = landmarks[20];
  const pinkyMcp = landmarks[17];

  // Finger is extended if tip is above (lower Y) than MCP
  const indexUp = indexTip.y < indexMcp.y;
  const middleUp = middleTip.y < middleMcp.y;
  const ringUp = ringTip.y < ringMcp.y;
  const pinkyUp = pinkyTip.y < pinkyMcp.y;

  // Count extended fingers
  const fingersUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // Fist: no fingers extended
  if (fingersUp === 0) return 'fist';

  // Point: only index extended
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'point';

  // Peace: index and middle extended
  if (indexUp && middleUp && !ringUp && !pinkyUp) return 'peace';

  // Open: 3+ fingers extended
  if (fingersUp >= 3) return 'open';

  return null;
}

interface UseHandTrackingOptions {
  enabled?: boolean;
  onHandMove?: (pos: HandPosition) => void;
}

export function useHandTracking({
  enabled = false,
  onHandMove,
}: UseHandTrackingOptions = {}) {
  const [isReady, setIsReady] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handPosition, setHandPosition] = useState<HandPosition | null>(null);
  const [gesture, setGesture] = useState<Gesture>(null);
  const [debug, setDebug] = useState<string>('Initializing...');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<MediaPipeCamera | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onHandMoveRef = useRef(onHandMove);
  const smoothedPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    onHandMoveRef.current = onHandMove;
  }, [onHandMove]);

  // Load MediaPipe scripts
  useEffect(() => {
    if (!enabled) return;

    // Check if already loaded
    if (typeof window !== 'undefined' && (window as any).Hands) {
      setDebug('MediaPipe ready');
      setIsReady(true);
      return;
    }

    setDebug('Loading MediaPipe...');

    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
    ];

    let loaded = 0;
    scripts.forEach(src => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false; // Load in order
      script.onload = () => {
        loaded++;
        if (loaded === scripts.length) {
          setDebug('MediaPipe loaded');
          setIsReady(true);
        }
      };
      script.onerror = () => {
        setError('Failed to load MediaPipe');
        setDebug('ERROR: Load failed');
      };
      document.body.appendChild(script);
    });
  }, [enabled]);

  // Start tracking
  const startTracking = useCallback(async () => {
    if (!isReady || isTracking) return;

    try {
      setDebug('Starting camera...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }
      });
      streamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.width = 320;
      video.height = 240;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      await video.play();
      videoRef.current = video;

      setDebug('Loading hand model...');

      // Initialize MediaPipe Hands (LITE model = fastest)
      const hands = new Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, // 0 = Lite (fastest), 1 = Full
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      hands.onResults((results: HandResults) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          // Index finger tip = landmark 8
          const indexTip = landmarks[8];

          const rawX = 1 - indexTip.x; // Mirror
          const rawY = indexTip.y;

          // Detect gesture first (needed for smoothing decision)
          const detectedGesture = detectGesture(landmarks);

          // Apply smoothing - nearly frozen when pointing for precision selection
          const smoothing = detectedGesture === 'point' ? 0.02 : 0.3; // Point = almost locked, others = responsive
          const deadZone = detectedGesture === 'point' ? 0.02 : 0; // Ignore tiny movements when pointing
          let smoothedX: number, smoothedY: number;

          if (smoothedPosRef.current) {
            const deltaX = rawX - smoothedPosRef.current.x;
            const deltaY = rawY - smoothedPosRef.current.y;

            // Dead zone: ignore small movements when pointing
            if (Math.abs(deltaX) < deadZone && Math.abs(deltaY) < deadZone && detectedGesture === 'point') {
              smoothedX = smoothedPosRef.current.x;
              smoothedY = smoothedPosRef.current.y;
            } else {
              smoothedX = smoothedPosRef.current.x + deltaX * smoothing;
              smoothedY = smoothedPosRef.current.y + deltaY * smoothing;
            }
          } else {
            smoothedX = rawX;
            smoothedY = rawY;
          }

          smoothedPosRef.current = { x: smoothedX, y: smoothedY };

          const pos: HandPosition = {
            x: smoothedX,
            y: smoothedY,
            confidence: 1,
          };

          setGesture(detectedGesture);

          const gestureEmoji = detectedGesture === 'fist' ? '✊' : detectedGesture === 'open' ? '🖐️' : detectedGesture === 'point' ? '👆' : detectedGesture === 'peace' ? '✌️' : '🤚';

          setHandPosition(pos);
          setDebug(`${gestureEmoji} X:${(pos.x * 100).toFixed(0)}% Y:${(pos.y * 100).toFixed(0)}%`);
          onHandMoveRef.current?.(pos);
        } else {
          setHandPosition(null);
          setGesture(null);
          smoothedPosRef.current = null;
        }
      });

      // Use Camera utility for smooth frame processing
      const camera = new Camera(video, {
        onFrame: async () => {
          await hands.send({ image: video });
        },
        width: 320,
        height: 240
      });

      camera.start();
      cameraRef.current = camera;
      setIsTracking(true);
      setDebug('Tracking! Show hand');

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera denied';
      setError(msg);
      setDebug(`ERROR: ${msg}`);
    }
  }, [isReady, isTracking]);

  const stopTracking = useCallback(() => {
    cameraRef.current?.stop();
    cameraRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    setIsTracking(false);
    setHandPosition(null);
    setDebug('Stopped');
  }, []);

  useEffect(() => {
    return () => stopTracking();
  }, [stopTracking]);

  return {
    isReady,
    isTracking,
    error,
    handPosition,
    gesture,
    debug,
    startTracking,
    stopTracking,
  };
}
