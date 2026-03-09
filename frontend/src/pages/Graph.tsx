import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { getGraph, getFile } from '../api/oracle';
import { useHandTracking } from '../hooks/useHandTracking';
import styles from './Graph.module.css';

interface Node {
  id: string;
  type: string;
  label: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  concepts?: string[];
  cluster?: number;
  position?: THREE.Vector3;
  source_file?: string;
  project?: string;  // ghq-style path for cross-repo access
}

interface Link {
  source: string;
  target: string;
}

const TYPE_COLORS_HEX: Record<string, string> = {
  principle: '#60a5fa',  // blue
  learning: '#fbbf24',   // yellow
  retro: '#4ade80',      // green
};

const TYPE_COLORS_NUM: Record<string, number> = {
  principle: 0x60a5fa,   // blue
  learning: 0xfbbf24,    // yellow
  retro: 0x4ade80,       // green
};

const STORAGE_KEY_VIEW = 'oracle-graph-view-mode';
const STORAGE_KEY_FULL = 'oracle-graph-show-full';
const STORAGE_KEY_HUD = 'oracle-graph-show-hud';
const DEFAULT_NODE_LIMIT = 200;

// KlakMath helpers for 3D
function xxhash(seed: number, data: number): number {
  let h = ((seed + 374761393) >>> 0);
  h = ((h + (data * 3266489917 >>> 0)) >>> 0);
  h = ((((h << 17) | (h >>> 15)) * 668265263) >>> 0);
  h ^= h >>> 15;
  h = ((h * 2246822519) >>> 0);
  h ^= h >>> 13;
  h = ((h * 3266489917) >>> 0);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hashOnSphere(seed: number, data: number): THREE.Vector3 {
  const phi = xxhash(seed, data) * Math.PI * 2;
  const cosTheta = xxhash(seed, data + 0x10000000) * 2 - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  return new THREE.Vector3(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta);
}

function hashInSphere(seed: number, data: number): THREE.Vector3 {
  const dir = hashOnSphere(seed, data);
  const raw = xxhash(seed + 77, data + 0x20000000);
  const r = 0.2 + 0.8 * raw * raw;
  return dir.multiplyScalar(r);
}

function cdsTween(state: { x: number; v: number }, target: number, speed: number, dt: number) {
  const n1 = state.v - (state.x - target) * (speed * speed * dt);
  const n2 = 1 + speed * dt;
  const nv = n1 / (n2 * n2);
  return { x: state.x + nv * dt, v: nv };
}

function noise1D(p: number, seed: number): number {
  const i = Math.floor(p);
  const f = p - i;
  const u = f * f * (3 - 2 * f);
  const g0 = xxhash(seed, i) * 2 - 1;
  const g1 = xxhash(seed, i + 1) * 2 - 1;
  return g0 * (1 - u) + g1 * u;
}

function fractalNoise(p: number, octaves: number, seed: number): number {
  let f = 0, w = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    f += w * noise1D(p, seed + i);
    max += w;
    p *= 2;
    w *= 0.5;
  }
  return f / max;
}

function clusterNodes(nodes: Node[], links: Link[]): Map<string, number> {
  const clusters = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  links.forEach(link => {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  });
  let clusterCount = 0;
  const visited = new Set<string>();
  const sortedNodes = [...nodes].sort((a, b) => (adjacency.get(b.id)?.size || 0) - (adjacency.get(a.id)?.size || 0));
  sortedNodes.forEach(node => {
    if (visited.has(node.id)) return;
    const queue = [node.id];
    const clusterMembers: string[] = [];
    while (queue.length > 0 && clusterMembers.length < 50) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      clusterMembers.push(current);
      const neighbors = adjacency.get(current) || new Set();
      neighbors.forEach(n => { if (!visited.has(n)) queue.push(n); });
    }
    clusterMembers.forEach(id => clusters.set(id, clusterCount));
    clusterCount++;
  });
  return clusters;
}

export function Graph() {
  // Shared state
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [allLinks, setAllLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    return saved === '3d' ? '3d' : '2d';
  });

  // Load graph data once
  useEffect(() => {
    loadGraph();
  }, []);

  async function loadGraph() {
    try {
      const data = await getGraph();
      const clusters = clusterNodes(data.nodes, data.links || []);
      const width = 800, height = 600;
      const centerX = width / 2, centerY = height / 2;

      const processedNodes = data.nodes.map((n: Node) => ({
        ...n,
        cluster: clusters.get(n.id) || 0,
        x: centerX + (Math.random() - 0.5) * 200,
        y: centerY + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
      }));

      setAllNodes(processedNodes);
      setAllLinks(data.links || []);
    } catch (e) {
      console.error('Failed to load graph:', e);
    } finally {
      setLoading(false);
    }
  }

  function toggleView() {
    const newView = viewMode === '2d' ? '3d' : '2d';
    setViewMode(newView);
    localStorage.setItem(STORAGE_KEY_VIEW, newView);
  }

  if (loading) {
    return <div className={styles.loading}>Loading graph...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Knowledge Graph</h1>
        <div className={styles.stats}>
          {allNodes.length} nodes · {allLinks.length} links
          <button
            onClick={toggleView}
            style={{
              marginLeft: '10px',
              background: viewMode === '3d' ? 'rgba(167, 139, 250, 0.3)' : 'rgba(96, 165, 250, 0.2)',
              border: `1px solid ${viewMode === '3d' ? '#a78bfa' : '#60a5fa'}`,
              borderRadius: '4px',
              color: viewMode === '3d' ? '#a78bfa' : '#60a5fa',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {viewMode === '2d' ? '→ 3D' : '→ 2D'}
          </button>
        </div>
      </div>

      {viewMode === '2d' ? (
        <Canvas2D nodes={allNodes} links={allLinks} />
      ) : (
        <Canvas3D nodes={allNodes} links={allLinks} />
      )}
    </div>
  );
}

// 2D Canvas Component
function Canvas2D({ nodes: allNodes, links: allLinks }: { nodes: Node[]; links: Link[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showFull, setShowFull] = useState(() => localStorage.getItem(STORAGE_KEY_FULL) === 'true');
  const animationRef = useRef<number>(0);

  useEffect(() => {
    applyNodeLimit(allNodes, allLinks, showFull);
  }, [allNodes, allLinks, showFull]);

  function applyNodeLimit(nodeList: Node[], linkList: Link[], full: boolean) {
    if (full || nodeList.length <= DEFAULT_NODE_LIMIT) {
      setNodes(nodeList);
      setLinks(linkList);
    } else {
      const byType: Record<string, Node[]> = {};
      nodeList.forEach(n => {
        if (!byType[n.type]) byType[n.type] = [];
        byType[n.type].push(n);
      });
      const types = Object.keys(byType);
      const perType = Math.floor(DEFAULT_NODE_LIMIT / types.length);
      const limitedNodes: Node[] = [];
      types.forEach(type => limitedNodes.push(...byType[type].slice(0, perType)));
      const remaining = DEFAULT_NODE_LIMIT - limitedNodes.length;
      if (remaining > 0) {
        const usedIds = new Set(limitedNodes.map(n => n.id));
        limitedNodes.push(...nodeList.filter(n => !usedIds.has(n.id)).slice(0, remaining));
      }
      const nodeIds = new Set(limitedNodes.map(n => n.id));
      setNodes(limitedNodes);
      setLinks(linkList.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target)));
    }
  }

  function toggleFullGraph() {
    const newFull = !showFull;
    setShowFull(newFull);
    localStorage.setItem(STORAGE_KEY_FULL, String(newFull));
  }

  useEffect(() => {
    if (nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width, height = canvas.height;
    let localNodes = [...nodes];
    let time = 0;
    let revealProgress = 0;
    const revealDuration = 10;

    function simulate() {
      time += 0.02;
      if (revealProgress < 1) revealProgress = Math.min(1, revealProgress + (0.02 / revealDuration));
      const alpha = 0.3;

      localNodes.forEach(node => {
        node.vx! += (Math.random() - 0.5) * 0.5;
        node.vy! += (Math.random() - 0.5) * 0.5;
      });

      for (let i = 0; i < localNodes.length; i++) {
        for (let j = i + 1; j < localNodes.length; j++) {
          const dx = localNodes[j].x! - localNodes[i].x!;
          const dy = localNodes[j].y! - localNodes[i].y!;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (100 / dist) * alpha;
          localNodes[i].vx! -= (dx / dist) * force;
          localNodes[i].vy! -= (dy / dist) * force;
          localNodes[j].vx! += (dx / dist) * force;
          localNodes[j].vy! += (dy / dist) * force;
        }
      }

      links.forEach(link => {
        const source = localNodes.find(n => n.id === link.source);
        const target = localNodes.find(n => n.id === link.target);
        if (!source || !target) return;
        const dx = target.x! - source.x!;
        const dy = target.y! - source.y!;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 50) * 0.01 * alpha;
        source.vx! += (dx / dist) * force;
        source.vy! += (dy / dist) * force;
        target.vx! -= (dx / dist) * force;
        target.vy! -= (dy / dist) * force;
      });

      localNodes.forEach(node => {
        node.vx! += (width / 2 - node.x!) * 0.01 * alpha;
        node.vy! += (height / 2 - node.y!) * 0.01 * alpha;
        node.vx! *= 0.9;
        node.vy! *= 0.9;
        node.x! += node.vx!;
        node.y! += node.vy!;
      });

      let cx = 0, cy = 0;
      localNodes.forEach(node => { cx += node.x!; cy += node.y!; });
      cx /= localNodes.length; cy /= localNodes.length;
      localNodes.forEach(node => { node.x! += width / 2 - cx; node.y! += height / 2 - cy; });

      const padding = 30;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      localNodes.forEach(node => {
        minX = Math.min(minX, node.x!); maxX = Math.max(maxX, node.x!);
        minY = Math.min(minY, node.y!); maxY = Math.max(maxY, node.y!);
      });
      const graphWidth = maxX - minX, graphHeight = maxY - minY;
      if (graphWidth > width - padding * 2 || graphHeight > height - padding * 2) {
        const scale = Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight) * 0.95;
        localNodes.forEach(node => {
          node.x! = width / 2 + (node.x! - width / 2) * scale;
          node.y! = height / 2 + (node.y! - height / 2) * scale;
        });
      }

      draw();
      animationRef.current = requestAnimationFrame(simulate);
    }

    function draw() {
      if (!ctx) return;
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      const visibleLinks = Math.floor(links.length * revealProgress);
      ctx.lineWidth = 0.5;
      links.slice(0, visibleLinks).forEach((link, i) => {
        const source = localNodes.find(n => n.id === link.source);
        const target = localNodes.find(n => n.id === link.target);
        if (!source || !target) return;
        const fadeIn = Math.min(1, (revealProgress - i / links.length) * 10);
        ctx.strokeStyle = `rgba(255,255,255,${0.08 * fadeIn})`;
        ctx.beginPath();
        ctx.moveTo(source.x!, source.y!);
        ctx.lineTo(target.x!, target.y!);
        ctx.stroke();

        const speed = 0.3 + (i % 5) * 0.1;
        const offset = (i * 0.1) % 1;
        const t = ((time * speed + offset) % 1);
        ctx.fillStyle = `rgba(167, 139, 250, ${0.6 * fadeIn})`;
        ctx.beginPath();
        ctx.arc(source.x! + (target.x! - source.x!) * t, source.y! + (target.y! - source.y!) * t, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      const nodeAlpha = Math.min(1, revealProgress * 3);
      localNodes.forEach(node => {
        const color = TYPE_COLORS_HEX[node.type] || '#888';
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${nodeAlpha})`;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    simulate();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [nodes, links]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const clicked = nodes.find(n => Math.sqrt((n.x! - x) ** 2 + (n.y! - y) ** 2) < 10);
    setSelectedNode(clicked || null);
  }

  return (
    <>
      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={styles.dot} style={{ background: TYPE_COLORS_HEX.principle }}></span>Principle</span>
        <span className={styles.legendItem}><span className={styles.dot} style={{ background: TYPE_COLORS_HEX.learning }}></span>Learning</span>
        <span className={styles.legendItem}><span className={styles.dot} style={{ background: TYPE_COLORS_HEX.retro }}></span>Retro</span>
        {allNodes.length > DEFAULT_NODE_LIMIT && (
          <button onClick={toggleFullGraph} style={{
            marginLeft: 'auto', background: showFull ? 'rgba(239, 68, 68, 0.2)' : 'rgba(74, 222, 128, 0.2)',
            border: `1px solid ${showFull ? '#ef4444' : '#4ade80'}`, borderRadius: '4px',
            color: showFull ? '#ef4444' : '#4ade80', padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
          }}>
            {showFull ? '⚡ Trim' : `📊 All ${allNodes.length}`}
          </button>
        )}
      </div>
      <div className={styles.canvasWrapper}>
        <canvas ref={canvasRef} width={800} height={600} onClick={handleCanvasClick} className={styles.canvas} />
      </div>
      {selectedNode && (
        <div className={styles.nodeInfo}>
          <span className={styles.nodeType}>{selectedNode.type}</span>
          <p className={styles.nodeLabel}>{selectedNode.label}</p>
        </div>
      )}
    </>
  );
}

// Lightning data structure
interface LightningData {
  line: THREE.Line;
  nodeA: number;
  nodeB: number;
  phase: number;
  speed: number;
}

// Straight line between two points
function createLightningPath(start: THREE.Vector3, end: THREE.Vector3, _segments = 8): THREE.Vector3[] {
  return [start.clone(), end.clone()];
}

// 3D Canvas Component
function Canvas3D({ nodes, links }: { nodes: Node[]; links: Link[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [clickedPos, setClickedPos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showHud, setShowHud] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_HUD);
    return saved === null ? true : saved === 'true'; // Show initially if no saved preference
  });
  const [hudAutoHidden, setHudAutoHidden] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Record<string, boolean>>({ principle: true, learning: true, retro: true });

  const [camDistance, setCamDistance] = useState(15);
  const [nodeSize, setNodeSize] = useState(0.08);
  const [rotationSpeed, setRotationSpeed] = useState(0.02);
  const [linkOpacity, setLinkOpacity] = useState(0.15);
  const [breathingIntensity, setBreathingIntensity] = useState(0.05);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [sphereMode, setSphereMode] = useState(true);
  const [handMode, setHandMode] = useState(false);
  const [lightningEnabled, setLightningEnabled] = useState(true);
  const [thunderEnabled, setThunderEnabled] = useState(false);
  const [laserTrail, setLaserTrail] = useState<{ x: number; y: number }[]>([]);

  const gestureRef = useRef<string | null>(null);

  const handleHandMove = useCallback((pos: { x: number; y: number }) => {
    // Disable rotation when pointing (for precise node selection)
    if (gestureRef.current === 'point') return;
    targetAngleRef.current = { x: (pos.x - 0.5) * Math.PI * 2, y: (pos.y - 0.5) * -1 };
  }, []);

  const { isReady: handReady, isTracking: handTracking, error: handError, handPosition, gesture, debug: handDebug, startTracking, stopTracking } = useHandTracking({ enabled: handMode, onHandMove: handleHandMove });

  // Keep gestureRef in sync
  useEffect(() => { gestureRef.current = gesture; }, [gesture]);

  // Track laser trail when pointing
  useEffect(() => {
    if (!handPosition) {
      setLaserTrail([]);
      return;
    }
    if (gesture === 'point') {
      setLaserTrail(prev => {
        const newTrail = [...prev, { x: handPosition.x, y: handPosition.y }];
        // Keep last 12 positions for the tail
        return newTrail.slice(-12);
      });
    } else {
      // Clear trail when not pointing
      setLaserTrail([]);
    }
  }, [handPosition, gesture]);

  // Laser pointer hover detection - use screen-space distance (works better when zoomed)
  useEffect(() => {
    if (!handMode || gesture !== 'point' || !handPosition) return;
    if (!cameraRef.current || meshesRef.current.length === 0 || !containerRef.current) return;

    const camera = cameraRef.current;
    const meshes = meshesRef.current;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Ensure camera matrices are up to date
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Convert hand position to screen pixels
    const laserX = handPosition.x * rect.width;
    const laserY = handPosition.y * rect.height;

    // Find closest node in screen space
    let closestNode: Node | null = null;
    let closestDist = Infinity;
    let closestMesh: THREE.Mesh | null = null;
    const threshold = 40; // pixels - how close laser needs to be

    meshes.forEach(mesh => {
      // Project 3D position to 2D screen
      const pos = mesh.position.clone();
      pos.project(camera);

      // Convert from NDC (-1 to 1) to screen pixels
      const screenX = (pos.x + 1) / 2 * rect.width;
      const screenY = (-pos.y + 1) / 2 * rect.height;

      // Calculate distance to laser
      const dist = Math.sqrt((screenX - laserX) ** 2 + (screenY - laserY) ** 2);

      if (dist < threshold && dist < closestDist) {
        closestDist = dist;
        closestNode = mesh.userData.node as Node;
        closestMesh = mesh;
      }
    });

    if (closestNode && closestMesh) {
      setHoveredNode(closestNode);
      meshes.forEach(m => {
        (m.material as THREE.MeshStandardMaterial).emissiveIntensity = m === closestMesh ? 0.8 : 0.5;
      });
    } else {
      setHoveredNode(null);
      meshes.forEach(m => {
        (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
      });
    }
  }, [handMode, gesture, handPosition, camDistance]);

  // Gesture-based zoom: fist = zoom in, point = hold, other = back to original
  const originalDistanceRef = useRef(15);
  const zoomedDistanceRef = useRef(8); // How close to zoom when fist

  useEffect(() => {
    if (!handMode) return;

    const zoomSpeed = 0.15; // Slower, smoother
    const interval = setInterval(() => {
      if (gesture === 'fist') {
        // Zoom in toward target
        setCamDistance(d => {
          const target = zoomedDistanceRef.current;
          if (d > target + 0.1) return d - zoomSpeed;
          return target;
        });
      } else if (gesture === 'point') {
        // Hold current zoom level - do nothing
      } else {
        // Return to original
        setCamDistance(d => {
          const target = originalDistanceRef.current;
          if (d < target - 0.1) return d + zoomSpeed;
          return target;
        });
      }
    }, 50);

    return () => clearInterval(interval);
  }, [handMode, gesture]);

  const toggleHandMode = useCallback(() => {
    if (handMode) { stopTracking(); setHandMode(false); } else { setHandMode(true); }
  }, [handMode, stopTracking]);

  useEffect(() => {
    if (handMode && handReady && !handTracking) startTracking();
  }, [handMode, handReady, handTracking, startTracking]);

  const hudRef = useRef({ camDistance: 15, nodeSize: 0.08, rotationSpeed: 0.02, linkOpacity: 0.15, breathingIntensity: 0.05, showAllLinks: false, sphereMode: false });
  const typeFilterRef = useRef<Record<string, boolean>>({ principle: true, learning: true, retro: true });
  const activeNodeRef = useRef<string | null>(null);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const camXRef = useRef({ x: 0, v: 0 });
  const camYRef = useRef({ x: 0, v: 0 });
  const targetAngleRef = useRef({ x: 0, y: 0 });
  const animationRef = useRef<number>(0);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const hudHoveredRef = useRef(false);

  // Lightning/thunder state refs
  const thunderTimerRef = useRef(0);
  const thunderActiveRef = useRef(false);
  const thunderFlashRef = useRef(0);
  const lightningsRef = useRef<LightningData[]>([]);
  const stormLightningsRef = useRef<LightningData[]>([]);
  const lightningEnabledRef = useRef(true);
  const thunderEnabledRef = useRef(false);

  const resetCamera = () => { setCamDistance(15); camXRef.current = { x: 0, v: 0 }; camYRef.current = { x: 0, v: 0 }; targetAngleRef.current = { x: 0, y: 0 }; };

  const loadFileContent = async (node: Node) => {
    if (!node.source_file) return;
    setFileLoading(true); setShowFilePanel(true);
    try {
      const data = await getFile(node.source_file, node.project);
      setFileContent(data.content || data.error || 'No content');
    } catch { setFileContent('Error loading file'); }
    finally { setFileLoading(false); }
  };

  useEffect(() => { hudRef.current = { camDistance, nodeSize, rotationSpeed, linkOpacity, breathingIntensity, showAllLinks, sphereMode }; }, [camDistance, nodeSize, rotationSpeed, linkOpacity, breathingIntensity, showAllLinks, sphereMode]);
  useEffect(() => { lightningEnabledRef.current = lightningEnabled; }, [lightningEnabled]);
  useEffect(() => { thunderEnabledRef.current = thunderEnabled; }, [thunderEnabled]);

  // Auto-hide HUD after 1 second on first load (if no saved preference)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_HUD);
    if (saved === null && !hudAutoHidden) {
      const timer = setTimeout(() => {
        setShowHud(false);
        setHudAutoHidden(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [hudAutoHidden]);

  // Save HUD state when user manually toggles
  const toggleHud = useCallback(() => {
    setShowHud(prev => {
      const newVal = !prev;
      localStorage.setItem(STORAGE_KEY_HUD, String(newVal));
      return newVal;
    });
  }, []);
  useEffect(() => { typeFilterRef.current = typeFilter; meshesRef.current.forEach(mesh => { mesh.visible = typeFilter[(mesh.userData.node as Node).type] ?? true; }); }, [typeFilter]);
  useEffect(() => { activeNodeRef.current = selectedNode?.id || hoveredNode?.id || null; }, [hoveredNode, selectedNode]);

  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth, height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a); // Dark blue-black canvas
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.z = 15;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x606080, 0.8);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(5, 5, 5);
    scene.add(directional);
    const rimLight = new THREE.PointLight(0xa78bfa, 0.5, 30);
    scene.add(rimLight);

    // Wireframe globe background (like Gesture Globe)
    const globeRadius = 6.5;
    const globeGeometry = new THREE.SphereGeometry(globeRadius, 32, 24);
    const globeWireframe = new THREE.WireframeGeometry(globeGeometry);
    const globeMaterial = new THREE.LineBasicMaterial({
      color: 0x6a5acd, // Slate blue/purple for globe wireframe
      opacity: 0.2,
      transparent: true,
    });
    const globeMesh = new THREE.LineSegments(globeWireframe, globeMaterial);
    scene.add(globeMesh);

    const clusterCenters = new Map<number, THREE.Vector3>();
    const maxCluster = Math.max(...nodes.map(n => n.cluster || 0));
    for (let i = 0; i <= maxCluster; i++) clusterCenters.set(i, hashOnSphere(42, i * 1000).multiplyScalar(6));

    const geometry = new THREE.SphereGeometry(0.08, 16, 16);
    const meshes: THREE.Mesh[] = [];
    const nodeMap = new Map<string, number>();

    nodes.forEach((node, i) => {
      nodeMap.set(node.id, i);
      // Color by type to match legend - bright and vibrant
      const color = TYPE_COLORS_NUM[node.type] || 0x888888;
      const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.3, emissive: color, emissiveIntensity: 0.5 });
      const mesh = new THREE.Mesh(geometry, material);
      const cluster = node.cluster || 0;
      const clusterCenter = clusterCenters.get(cluster) || new THREE.Vector3();
      const localPos = hashInSphere(cluster + 100, i).multiplyScalar(2.5);
      const clusterPos = clusterCenter.clone().add(localPos);
      const sphereR = (0.7 + 0.3 * xxhash(77, i + 0x20000000)) * 6;
      const spherePos = hashOnSphere(42, i).multiplyScalar(sphereR);
      mesh.position.copy(clusterPos);
      mesh.userData = { node, index: i, clusterPos: clusterPos.clone(), spherePos: spherePos.clone(), currentPos: clusterPos.clone() };
      scene.add(mesh);
      meshes.push(mesh);
    });
    meshesRef.current = meshes;

    const adjacency = new Map<string, Set<string>>();
    nodes.forEach(n => adjacency.set(n.id, new Set()));
    links.forEach(link => { adjacency.get(link.source)?.add(link.target); adjacency.get(link.target)?.add(link.source); });
    adjacencyRef.current = adjacency;

    const maxLinks = Math.min(links.length, 3000);
    const linkLines: THREE.Line[] = [];
    interface LinkData { sourceIdx: number; targetIdx: number; sourceId: string; targetId: string; offset: number; speed: number; line: THREE.Line; }
    const linkDataArray: LinkData[] = [];
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0xa78bfa, opacity: 0, transparent: true });

    for (let i = 0; i < maxLinks; i++) {
      const link = links[i];
      const srcIdx = nodeMap.get(link.source), tgtIdx = nodeMap.get(link.target);
      if (srcIdx === undefined || tgtIdx === undefined) continue;
      const lineGeom = new THREE.BufferGeometry().setFromPoints([meshes[srcIdx].position.clone(), meshes[tgtIdx].position.clone()]);
      const line = new THREE.Line(lineGeom, linkMaterial.clone());
      scene.add(line);
      linkLines.push(line);
      linkDataArray.push({ sourceIdx: srcIdx, targetIdx: tgtIdx, sourceId: link.source, targetId: link.target, offset: xxhash(42, i + 5000), speed: 0.2 + xxhash(42, i + 6000) * 0.3, line });
    }

    // Create lightning lines for ALL links (will show only when hovering connected node)
    const ambientLightnings: LightningData[] = [];
    for (let i = 0; i < linkDataArray.length; i++) {
      const linkData = linkDataArray[i];
      if (!linkData) continue;
      const start = meshes[linkData.sourceIdx].position;
      const end = meshes[linkData.targetIdx].position;
      const points = createLightningPath(start, end, 6);
      const lightningGeom = new THREE.BufferGeometry().setFromPoints(points);
      // Color based on connected node type
      const sourceNode = meshes[linkData.sourceIdx]?.userData?.node as Node | undefined;
      const lightningColor = sourceNode ? TYPE_COLORS_NUM[sourceNode.type] || 0x88ccff : 0x88ccff;
      const lightningMat = new THREE.LineBasicMaterial({
        color: lightningColor,
        opacity: 0.5,
        transparent: true,
        blending: THREE.AdditiveBlending,
      });
      const lightningLine = new THREE.Line(lightningGeom, lightningMat);
      lightningLine.visible = false; // Hidden by default
      scene.add(lightningLine);
      ambientLightnings.push({
        line: lightningLine,
        nodeA: linkData.sourceIdx,
        nodeB: linkData.targetIdx,
        phase: xxhash(42, i + 10000) * Math.PI * 2,
        speed: 0.5 + xxhash(42, i + 11000) * 1.5,
      });
    }
    lightningsRef.current = ambientLightnings;

    // Storm lightning no longer needed - ambient covers all links
    const stormLightnings: LightningData[] = [];
    stormLightningsRef.current = stormLightnings;

    // Thunder trigger function
    function triggerThunder() {
      thunderActiveRef.current = true;
      thunderFlashRef.current = 1.0;

      // Flash all nodes bright
      meshes.forEach(mesh => {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
      });

      // Show storm lightnings
      stormLightnings.forEach(lightning => {
        lightning.line.visible = true;
      });

      // Multi-flash effect
      setTimeout(() => { thunderFlashRef.current = 0.8; }, 50);
      setTimeout(() => { thunderFlashRef.current = 1.0; }, 100);
      setTimeout(() => { thunderFlashRef.current = 0.6; }, 150);

      // End thunder after 400ms
      setTimeout(() => {
        thunderActiveRef.current = false;
        meshes.forEach(mesh => {
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
        });
        stormLightnings.forEach(lightning => {
          lightning.line.visible = false;
        });
      }, 400);
    }

    const particleCount = Math.min(maxLinks, 1500);
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ size: 0.06, color: 0xa78bfa, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const travelingParticles = new THREE.Points(particleGeometry, particleMaterial);
    travelingParticles.visible = false;
    scene.add(travelingParticles);

    let time = 0;
    const dt = 1 / 60;
    const mouse = new THREE.Vector2(10, 10); // Start outside globe area (dim)
    let isHoveringNode = false;

    function animate() {
      // Only advance time if not hovering a node (pause animations)
      if (!isHoveringNode) {
        time += 0.016;
      }
      camXRef.current = cdsTween(camXRef.current, targetAngleRef.current.x, 3, dt);
      camYRef.current = cdsTween(camYRef.current, targetAngleRef.current.y, 3, dt);
      const camDist = hudRef.current.camDistance;
      camera.position.x = Math.sin(camXRef.current.x) * camDist;
      camera.position.z = Math.cos(camXRef.current.x) * camDist;
      camera.position.y = camYRef.current.x * 5;
      camera.lookAt(0, 0, 0);

      const isSphere = hudRef.current.sphereMode;

      // Check if mouse is inside the globe area (for brightness effect)
      const globeCenter = new THREE.Vector3(0, 0, 0);
      globeCenter.project(camera);
      const mouseDistFromCenter = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
      const isInsideGlobe = mouseDistFromCenter < 0.7; // approximate globe screen radius
      const globalBrightness = isInsideGlobe ? 0.6 : 0.25;

      // Dock-style magnification: project nodes to screen and scale by mouse proximity
      const tempVec = new THREE.Vector3();

      meshes.forEach((mesh, i) => {
        const clusterPos = mesh.userData.clusterPos as THREE.Vector3;
        const spherePos = mesh.userData.spherePos as THREE.Vector3;
        const currentPos = mesh.userData.currentPos as THREE.Vector3;
        currentPos.lerp(isSphere ? spherePos : clusterPos, 0.05);
        const n = fractalNoise(time * 0.5 + i * 0.1, 2, 42);
        mesh.position.copy(currentPos).multiplyScalar(1 + n * hudRef.current.breathingIntensity);

        // Calculate dock magnification (in normalized screen space)
        tempVec.copy(mesh.position);
        tempVec.project(camera);
        // Account for aspect ratio in distance calculation
        const aspectRatio = width / height;
        const screenDist = Math.sqrt(
          Math.pow((tempVec.x - mouse.x) * aspectRatio, 2) +
          Math.pow(tempVec.y - mouse.y, 2)
        );
        // Magnify nodes close to mouse (dock effect) - subtle
        const maxMagnify = 1.8;
        const magnifyRadius = 0.4;
        const magnifyFactor = screenDist < magnifyRadius
          ? 1 + (maxMagnify - 1) * (1 - screenDist / magnifyRadius)
          : 1;

        mesh.scale.setScalar((hudRef.current.nodeSize / 0.08) * magnifyFactor);
        mesh.rotation.y = time * 0.2 + i * 0.01;

        // Apply global brightness based on mouse inside/outside globe
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = globalBrightness + (magnifyFactor - 1) * 0.3;
      });

      scene.rotation.y = time * hudRef.current.rotationSpeed;

      const activeId = activeNodeRef.current;
      const showAll = hudRef.current.showAllLinks;
      const currentTypeFilter = typeFilterRef.current;
      let particleIndex = 0;
      const positions = travelingParticles.geometry.attributes.position.array as Float32Array;

      linkDataArray.forEach((linkData) => {
        const mat = linkData.line.material as THREE.LineBasicMaterial;
        const isConnected = activeId && (linkData.sourceId === activeId || linkData.targetId === activeId);
        const sourceNode = meshes[linkData.sourceIdx]?.userData?.node as Node | undefined;
        const targetNode = meshes[linkData.targetIdx]?.userData?.node as Node | undefined;
        const linkVisible = (sourceNode ? currentTypeFilter[sourceNode.type] ?? true : true) && (targetNode ? currentTypeFilter[targetNode.type] ?? true : true);
        const srcPos = meshes[linkData.sourceIdx].position, tgtPos = meshes[linkData.targetIdx].position;
        const linePositions = linkData.line.geometry.attributes.position.array as Float32Array;
        linePositions[0] = srcPos.x; linePositions[1] = srcPos.y; linePositions[2] = srcPos.z;
        linePositions[3] = tgtPos.x; linePositions[4] = tgtPos.y; linePositions[5] = tgtPos.z;
        linkData.line.geometry.attributes.position.needsUpdate = true;

        // Show straight lines normally, hide when lightning is active for this link
        if (!linkVisible) mat.opacity = 0;
        else if (showAll) mat.opacity = 0.04;
        else if (isConnected && !lightningEnabledRef.current) mat.opacity = hudRef.current.linkOpacity;
        else if (isConnected && lightningEnabledRef.current) mat.opacity = 0; // Lightning handles it
        else mat.opacity = 0;

        if (isConnected && linkVisible && particleIndex < 1500) {
          const t = ((time * linkData.speed * 0.3 + linkData.offset) % 1);
          positions[particleIndex * 3] = srcPos.x + (tgtPos.x - srcPos.x) * t;
          positions[particleIndex * 3 + 1] = srcPos.y + (tgtPos.y - srcPos.y) * t;
          positions[particleIndex * 3 + 2] = srcPos.z + (tgtPos.z - srcPos.z) * t;
          particleIndex++;
        }
      });

      for (let i = particleIndex; i < 1500; i++) { positions[i * 3] = 0; positions[i * 3 + 1] = -1000; positions[i * 3 + 2] = 0; }
      travelingParticles.visible = !!activeId;
      travelingParticles.geometry.attributes.position.needsUpdate = true;

      // Lightning system - only active in sphere mode (lightning stays inside globe)
      const sphereActive = hudRef.current.sphereMode;
      if (lightningEnabledRef.current && sphereActive) {
        // Thunder/flash system (only if enabled)
        if (thunderEnabledRef.current) {
          thunderTimerRef.current += 0.016;
          if (thunderTimerRef.current > 5 + Math.random() * 3) {
            triggerThunder();
            thunderTimerRef.current = 0;
          }

          // Flash decay and background color shift
          if (thunderFlashRef.current > 0) {
            thunderFlashRef.current *= 0.92;
            if (thunderFlashRef.current < 0.01) thunderFlashRef.current = 0;
            scene.background = new THREE.Color(
              0.04 + thunderFlashRef.current * 0.25,
              0.04 + thunderFlashRef.current * 0.25,
              0.06 + thunderFlashRef.current * 0.35
            );
          } else {
            scene.background = new THREE.Color(0x05050a);
          }
        }

        // Update ambient lightnings - ONLY show when hovering/selected a specific node
        const activeId = activeNodeRef.current;

        // Hide ALL lightning if no node is active
        if (!activeId) {
          ambientLightnings.forEach((lightning) => {
            lightning.line.visible = false;
          });
        } else {
          // Show lightning only for connections to the active node
          ambientLightnings.forEach((lightning) => {
            const { line, nodeA, nodeB } = lightning;
            const sourceNode = meshes[nodeA]?.userData?.node as Node | undefined;
            const targetNode = meshes[nodeB]?.userData?.node as Node | undefined;
            const isConnected = (sourceNode?.id === activeId || targetNode?.id === activeId);

            if (isConnected) {
              line.visible = true;
              // Regenerate lightning path for flicker effect
              if (Math.random() < 0.15) {
                const start = meshes[nodeA].position;
                const end = meshes[nodeB].position;
                const newPoints = createLightningPath(start, end, 6);
                line.geometry.setFromPoints(newPoints);
              }
              const mat = line.material as THREE.LineBasicMaterial;
              mat.opacity = 0.6;
            } else {
              line.visible = false;
            }
          });
        }

        // Storm lightnings (only during thunder if enabled)
        stormLightnings.forEach((lightning) => {
          lightning.line.visible = thunderEnabledRef.current && thunderActiveRef.current;
          if (thunderActiveRef.current && thunderEnabledRef.current) {
            if (Math.random() < 0.3) {
              const start = meshes[lightning.nodeA].position;
              const end = meshes[lightning.nodeB].position;
              const newPoints = createLightningPath(start, end, 8);
              lightning.line.geometry.setFromPoints(newPoints);
            }
            const mat = lightning.line.material as THREE.LineBasicMaterial;
            mat.opacity = 0.5 + Math.random() * 0.5;
          }
        });
      } else {
        // Lightning disabled or not in sphere mode - hide all lightning lines
        ambientLightnings.forEach(l => { l.line.visible = false; });
        stormLightnings.forEach(l => { l.line.visible = false; });
        scene.background = new THREE.Color(0x05050a);
      }

      // Show/hide globe wireframe only in sphere mode
      globeMesh.visible = sphereActive;

      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    }

    animate();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.5 };  // Easier to hit points
    raycasterRef.current = raycaster;
    let isDragging = false, dragStart = { x: 0, y: 0 };

    function onMouseDown(e: MouseEvent) { if (hudHoveredRef.current) return; isDragging = true; dragStart = { x: e.clientX, y: e.clientY }; container.style.cursor = 'grabbing'; }
    function onMouseUp() { isDragging = false; container.style.cursor = 'default'; }
    function onMouseMove(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;
      setMousePos({ x: e.clientX, y: e.clientY });
      if (isDragging) {
        targetAngleRef.current.x += (e.clientX - dragStart.x) * 0.005;
        targetAngleRef.current.y = Math.max(-0.5, Math.min(0.5, targetAngleRef.current.y - (e.clientY - dragStart.y) * 0.003));
        dragStart = { x: e.clientX, y: e.clientY };
      }
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshes);
      if (intersects.length > 0) {
        setHoveredNode(intersects[0].object.userData.node as Node);
        if (!isDragging) container.style.cursor = 'pointer';
        meshes.forEach(m => { (m.material as THREE.MeshStandardMaterial).emissiveIntensity = m === intersects[0].object ? 0.8 : 0.5; });
        isHoveringNode = true;
      } else {
        setHoveredNode(null);
        if (!isDragging) container.style.cursor = 'default';
        meshes.forEach(m => { (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5; });
        isHoveringNode = false;
      }
    }
    function onClick(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshes);
      if (intersects.length > 0) {
        const clicked = intersects[0].object.userData.node as Node;
        setSelectedNode(prev => prev?.id === clicked.id ? null : clicked);
        setClickedPos({ x: e.clientX, y: e.clientY }); // Save click position for tooltip
      }
    }
    function onDblClick() { setSelectedNode(null); }
    function onWheel(e: WheelEvent) { e.preventDefault(); setCamDistance(prev => Math.max(5, Math.min(50, prev + (e.deltaY > 0 ? 1.5 : -1.5)))); }
    function onResize() { const w = container.clientWidth, h = container.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);
    container.addEventListener('dblclick', onDblClick);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mouseleave', onMouseUp);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      meshes.forEach(mesh => { (mesh.material as THREE.Material).dispose(); scene.remove(mesh); });
      geometry.dispose();
      // Cleanup globe
      globeWireframe.dispose();
      globeMaterial.dispose();
      scene.remove(globeMesh);
      linkLines.forEach(line => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); scene.remove(line); });
      // Cleanup lightning lines
      ambientLightnings.forEach(lightning => { lightning.line.geometry.dispose(); (lightning.line.material as THREE.Material).dispose(); scene.remove(lightning.line); });
      stormLightnings.forEach(lightning => { lightning.line.geometry.dispose(); (lightning.line.material as THREE.Material).dispose(); scene.remove(lightning.line); });
      lightningsRef.current = [];
      stormLightningsRef.current = [];
      particleGeometry.dispose();
      particleMaterial.dispose();
      scene.remove(travelingParticles);
      container.removeChild(renderer.domElement);
      renderer.dispose();
      meshesRef.current = [];
    };
  }, [nodes, links]);

  const counts: Record<string, number> = {};
  nodes.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });

  return (
    <>
      <div className={styles.legend}>
        {[{ key: 'principle', label: 'Principle', color: '#60a5fa' }, { key: 'learning', label: 'Learning', color: '#fbbf24' }, { key: 'retro', label: 'Retro', color: '#4ade80' }].map(({ key, label, color }) => {
          const count = counts[key] || 0;
          return (
            <button key={key} onClick={() => setTypeFilter(prev => ({ ...prev, [key]: !prev[key] }))} style={{ opacity: count === 0 ? 0.3 : (typeFilter[key] ? 1 : 0.4), cursor: count > 0 ? 'pointer' : 'default', background: 'transparent', border: 'none', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px', color: '#e0e0e0', fontSize: '13px' }}>
              <span className={styles.dot} style={{ background: color }}></span>
              {label} ({count})
            </button>
          );
        })}
      </div>

      <div className={styles.controls}>
        <span className={styles.hint}>Drag to rotate • Scroll to zoom • Click to select</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={toggleHandMode} className={styles.hudToggle} style={{ background: handTracking ? '#4ade80' : undefined, color: handTracking ? '#000' : undefined }}>{handTracking ? '✋ ON' : '✋'}</button>
          <button onClick={resetCamera} className={styles.hudToggle}>Reset</button>
          <button onClick={toggleHud} className={styles.hudToggle}>{showHud ? 'Hide' : 'Show'}</button>
        </div>
      </div>

      <div ref={containerRef} className={styles.canvas3d}>
        {showHud && (
          <div className={styles.hud} onMouseEnter={() => { hudHoveredRef.current = true; }} onMouseLeave={() => { hudHoveredRef.current = false; }}>
            <div className={styles.hudTitle}>Controls</div>
            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <input type="checkbox" checked={sphereMode} onChange={(e) => setSphereMode(e.target.checked)} style={{ width: '16px', height: '16px' }} />
              <span style={{ color: '#a78bfa' }}>Sphere Mode</span>
            </label>
            <label className={styles.hudLabel}>Distance: {camDistance}<input type="range" min="5" max="40" step="1" value={camDistance} onChange={(e) => setCamDistance(Number(e.target.value))} className={styles.hudSlider} /></label>
            <label className={styles.hudLabel}>Node Size: {nodeSize.toFixed(2)}<input type="range" min="0.02" max="0.2" step="0.01" value={nodeSize} onChange={(e) => setNodeSize(Number(e.target.value))} className={styles.hudSlider} /></label>
            <label className={styles.hudLabel}>Rotation: {rotationSpeed.toFixed(3)}<input type="range" min="0" max="0.1" step="0.005" value={rotationSpeed} onChange={(e) => setRotationSpeed(Number(e.target.value))} className={styles.hudSlider} /></label>
            <label className={styles.hudLabel}>Breathing: {breathingIntensity.toFixed(2)}<input type="range" min="0" max="0.2" step="0.01" value={breathingIntensity} onChange={(e) => setBreathingIntensity(Number(e.target.value))} className={styles.hudSlider} /></label>
            <div className={styles.hudDivider}>Links</div>
            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><input type="checkbox" checked={showAllLinks} onChange={(e) => setShowAllLinks(e.target.checked)} style={{ width: '16px', height: '16px' }} />Show All Links</label>
            <label className={styles.hudLabel}>Opacity: {linkOpacity.toFixed(2)}<input type="range" min="0.05" max="0.5" step="0.05" value={linkOpacity} onChange={(e) => setLinkOpacity(Number(e.target.value))} className={styles.hudSlider} /></label>
            <div className={styles.hudDivider}>Effects</div>
            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={lightningEnabled} onChange={(e) => setLightningEnabled(e.target.checked)} style={{ width: '16px', height: '16px' }} />
              <span style={{ color: '#88ccff' }}>⚡ Lightning</span>
            </label>
            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={thunderEnabled} onChange={(e) => setThunderEnabled(e.target.checked)} style={{ width: '16px', height: '16px' }} />
              <span style={{ color: thunderEnabled ? '#fbbf24' : '#888' }}>⛈️ Thunder Flash</span>
            </label>
          </div>
        )}
      </div>

      {(hoveredNode || selectedNode) && !showFilePanel && (() => {
        // For laser hover: use absolute positioning within container (same as laser dot)
        const useLaserPosition = handMode && gesture === 'point' && handPosition && !selectedNode;

        if (useLaserPosition) {
          return (
            <div
              style={{
                position: 'absolute',
                left: `${handPosition.x * 100}%`,
                top: `${handPosition.y * 100}%`,
                transform: 'translate(15px, -50%)',  // Offset to the right of laser
                background: 'rgba(20, 20, 30, 0.95)',
                borderRadius: '8px',
                padding: '8px 12px',
                border: '1px solid rgba(255,255,255,0.1)',
                pointerEvents: 'none',
                zIndex: 1000,
                maxWidth: '200px',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                background: TYPE_COLORS_HEX[hoveredNode?.type || ''] || '#888',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
              }}>{hoveredNode?.type}</span>
              <p style={{ color: '#e0e0e0', fontSize: '12px', margin: '6px 0 0 0', lineHeight: '1.3' }}>
                {hoveredNode?.label || hoveredNode?.source_file?.split('/').pop()?.replace(/\.md$/, '').replace(/-/g, ' ') || 'Untitled'}
              </p>
            </div>
          );
        }

        // For mouse hover / selected node: use fixed positioning
        const tooltipX = selectedNode ? clickedPos.x + 20 : mousePos.x + 20;
        const tooltipY = selectedNode ? clickedPos.y - 10 : mousePos.y - 10;

        return (
        <div
          style={{
            position: 'fixed',
            left: tooltipX,
            top: tooltipY,
            background: 'rgba(20, 20, 30, 0.95)',
            borderRadius: '8px',
            padding: '8px 12px',
            border: '1px solid rgba(255,255,255,0.1)',
            pointerEvents: selectedNode ? 'auto' : 'none',
            zIndex: 1000,
            maxWidth: '200px',
          }}
        >
          <span style={{
            background: TYPE_COLORS_HEX[(selectedNode || hoveredNode)?.type || ''] || '#888',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
          }}>{(selectedNode || hoveredNode)?.type}</span>
          <p style={{ color: '#e0e0e0', fontSize: '12px', margin: '6px 0 0 0', lineHeight: '1.3' }}>
            {(selectedNode || hoveredNode)?.label || (selectedNode || hoveredNode)?.source_file?.split('/').pop()?.replace(/\.md$/, '').replace(/-/g, ' ') || 'Untitled'}
          </p>
          {selectedNode?.source_file && (
            <a href="#" onClick={(e) => { e.preventDefault(); loadFileContent(selectedNode); }} style={{ color: '#60a5fa', fontSize: '10px', textDecoration: 'underline' }}>View file</a>
          )}
        </div>
        );
      })()}

      {showFilePanel && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => { setShowFilePanel(false); setFileContent(null); }}>
          <div style={{ width: '90%', maxWidth: '800px', maxHeight: '80vh', background: 'rgba(15, 15, 25, 0.98)', borderRadius: '16px', padding: '24px', overflow: 'auto', border: '1px solid rgba(167, 139, 250, 0.3)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ color: '#a78bfa', margin: 0, fontSize: '16px' }}>{selectedNode?.source_file?.split('/').pop()}</h3>
            <button onClick={() => { setShowFilePanel(false); setFileContent(null); }} style={{ background: 'transparent', border: '1px solid #666', borderRadius: '4px', color: '#888', padding: '6px 16px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
          </div>
          {fileLoading ? (
            <p style={{ color: '#888' }}>Loading...</p>
          ) : fileContent?.startsWith('File not found') && selectedNode?.project ? (
            <div style={{ color: '#888' }}>
              <p>{fileContent}</p>
              <a
                href={`https://${selectedNode.project}/blob/main/${selectedNode.source_file}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'underline' }}
              >
                View on GitHub →
              </a>
            </div>
          ) : (
            <pre style={{ color: '#e0e0e0', fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace' }}>{fileContent}</pre>
          )}
          </div>
        </div>
      )}

      {handMode && (
        <>
          {/* Laser trail dots when pointing */}
          {gesture === 'point' && laserTrail.map((p, i) => {
            const opacity = (i + 1) / laserTrail.length; // Fade from start to end
            const size = 4 + (opacity * 8); // Grow from 4px to 12px
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  marginLeft: `${-size / 2}px`,
                  marginTop: `${-size / 2}px`,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, rgba(255, 100, 100, ${opacity}) 0%, rgba(255, 50, 50, ${opacity * 0.6}) 50%, transparent 80%)`,
                  boxShadow: `0 0 ${6 * opacity}px rgba(255, 80, 80, ${opacity}), 0 0 ${12 * opacity}px rgba(255, 50, 50, ${opacity * 0.5})`,
                  pointerEvents: 'none',
                  zIndex: 199,
                }}
              />
            );
          })}
          {/* Hand position indicator - laser pointer when pointing, orb otherwise */}
          {/* Laser turns GREEN when hovering a node */}
          {handPosition && (() => {
            const isLaserHovering = gesture === 'point' && hoveredNode;
            const laserColor = isLaserHovering ? { r: 80, g: 255, b: 80 } : { r: 255, g: 80, b: 80 };
            return (
            <div
              style={{
                position: 'absolute',
                left: `${handPosition.x * 100}%`,
                top: `${handPosition.y * 100}%`,
                width: gesture === 'point' ? '16px' : '36px',
                height: gesture === 'point' ? '16px' : '36px',
                marginLeft: gesture === 'point' ? '-8px' : '-18px',
                marginTop: gesture === 'point' ? '-8px' : '-18px',
                borderRadius: '50%',
                background: gesture === 'point'
                  ? `radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(${laserColor.r}, ${laserColor.g}, ${laserColor.b}, 1) 30%, rgba(${laserColor.r}, ${laserColor.g}, ${laserColor.b}, 0.8) 60%, transparent 80%)`
                  : 'radial-gradient(circle, rgba(255, 180, 50, 1) 0%, rgba(255, 150, 30, 0.8) 30%, rgba(255, 120, 0, 0.3) 60%, transparent 80%)',
                boxShadow: gesture === 'point'
                  ? `0 0 10px rgba(${laserColor.r}, ${laserColor.g}, ${laserColor.b}, 1), 0 0 20px rgba(${laserColor.r}, ${laserColor.g}, ${laserColor.b}, 0.9), 0 0 30px rgba(${laserColor.r}, ${laserColor.g}, ${laserColor.b}, 0.6)`
                  : '0 0 20px rgba(255, 150, 30, 1), 0 0 40px rgba(255, 120, 0, 0.6), 0 0 60px rgba(255, 100, 0, 0.3)',
                pointerEvents: 'none',
                zIndex: 200,
                transition: 'left 0.08s ease-out, top 0.08s ease-out, width 0.15s, height 0.15s, margin 0.15s, background 0.15s, box-shadow 0.15s',
              }}
            >
              {gesture !== 'point' && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '14px',
                    height: '14px',
                    marginLeft: '-7px',
                    marginTop: '-7px',
                    borderRadius: '50%',
                    background: '#ffb830',
                    boxShadow: '0 0 8px #ff9500',
                  }}
                />
              )}
            </div>
            );
          })()}
          {/* Hand tracking info panel */}
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(15, 15, 25, 0.9)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(74, 222, 128, 0.3)', zIndex: 100 }}>
            <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>✋ Hand Tracking</div>
            <div style={{ color: '#888', fontSize: '10px' }}>{handDebug}</div>
            {handError ? (
              <div style={{ color: '#f87171', fontSize: '11px' }}>{handError}</div>
            ) : handPosition ? (
              <>
                <div style={{ color: '#e0e0e0', fontSize: '11px' }}>X: {(handPosition.x * 100).toFixed(0)}% | Y: {(handPosition.y * 100).toFixed(0)}%</div>
                {gesture && <div style={{ color: '#fbbf24', fontSize: '10px', marginTop: '4px' }}>{gesture === 'fist' ? '✊ Zoom In' : gesture === 'point' ? '👆 Hold' : gesture === 'peace' ? '✌️ Peace' : gesture === 'open' ? '🖐️ Release' : ''}</div>}
              </>
            ) : (
              <div style={{ color: '#888', fontSize: '11px' }}>Show hand to camera</div>
            )}
          </div>
        </>
      )}
    </>
  );
}
