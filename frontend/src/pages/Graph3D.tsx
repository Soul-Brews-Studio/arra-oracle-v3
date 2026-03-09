import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { getGraph, getFile } from '../api/oracle';
import { useHandTracking } from '../hooks/useHandTracking';
import styles from './Graph3D.module.css';

interface Node {
  id: string;
  type: string;
  label: string;
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

const TYPE_COLORS: Record<string, number> = {
  principle: 0xa78bfa,  // Purple
  learning: 0x4ade80,   // Green
  retro: 0x38bdf8,      // Cyan/sky blue (more distinct from purple)
};

// KlakMath: XXHash for deterministic random
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

// KlakMath: Point on sphere
function hashOnSphere(seed: number, data: number): THREE.Vector3 {
  const phi = xxhash(seed, data) * Math.PI * 2;
  const cosTheta = xxhash(seed, data + 0x10000000) * 2 - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  return new THREE.Vector3(
    sinTheta * Math.cos(phi),
    sinTheta * Math.sin(phi),
    cosTheta
  );
}

// Volume distribution: surface-biased but with real depth (range 0.2–1.0)
function hashInSphere(seed: number, data: number): THREE.Vector3 {
  const dir = hashOnSphere(seed, data);
  const raw = xxhash(seed + 77, data + 0x20000000);
  const r = 0.2 + 0.8 * raw * raw;  // quadratic bias toward surface, but goes deep
  return dir.multiplyScalar(r);
}

// KlakMath: CdsTween spring
function cdsTween(state: { x: number; v: number }, target: number, speed: number, dt: number) {
  const n1 = state.v - (state.x - target) * (speed * speed * dt);
  const n2 = 1 + speed * dt;
  const nv = n1 / (n2 * n2);
  return { x: state.x + nv * dt, v: nv };
}

// KlakMath: Fractal noise
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

// Simple clustering: group nodes by shared links
function clusterNodes(nodes: Node[], links: Link[]): Map<string, number> {
  const clusters = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  // Build adjacency list
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  links.forEach(link => {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  });

  // Assign clusters based on most connected neighbor groups
  let clusterCount = 0;
  const visited = new Set<string>();

  // Sort by connection count (most connected first)
  const sortedNodes = [...nodes].sort((a, b) => {
    return (adjacency.get(b.id)?.size || 0) - (adjacency.get(a.id)?.size || 0);
  });

  sortedNodes.forEach(node => {
    if (visited.has(node.id)) return;

    // BFS to find cluster members
    const queue = [node.id];
    const clusterMembers: string[] = [];

    while (queue.length > 0 && clusterMembers.length < 50) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      clusterMembers.push(current);

      const neighbors = adjacency.get(current) || new Set();
      neighbors.forEach(n => {
        if (!visited.has(n)) queue.push(n);
      });
    }

    clusterMembers.forEach(id => clusters.set(id, clusterCount));
    clusterCount++;
  });

  return clusters;
}

const STORAGE_KEY_VIEW = 'oracle-graph-view-mode';

export function Graph3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);  // Clicked/locked node
  const [showHud, setShowHud] = useState(true);
  const navigate = useNavigate();

  // File viewer state
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);

  // Type filter state
  const [typeFilter, setTypeFilter] = useState<Record<string, boolean>>({
    principle: true,
    learning: true,
    retro: true,
  });

  // HUD controls (state for UI, refs for animation loop)
  const [camDistance, setCamDistance] = useState(15);
  const [nodeSize, setNodeSize] = useState(0.08);
  const [rotationSpeed, setRotationSpeed] = useState(0.02);
  const [linkOpacity, setLinkOpacity] = useState(0.15);  // For active links
  const [breathingIntensity, setBreathingIntensity] = useState(0.05);
  const [ambientLight, setAmbientLight] = useState(0.8);
  const [directLight, setDirectLight] = useState(1.2);
  const [particleSpeed, setParticleSpeed] = useState(0.3);
  const [showAllLinks, setShowAllLinks] = useState(false);  // Toggle all links
  const [sphereMode, setSphereMode] = useState(false);  // Sphere vs Cluster layout
  const [handMode, setHandMode] = useState(false);  // Hand gesture control

  // Hand tracking callback - maps hand position to camera rotation
  const handleHandMove = useCallback((pos: { x: number; y: number }) => {
    // Map normalized hand position (0-1) to rotation angles
    // x: left-right hand movement -> horizontal rotation
    // y: up-down hand movement -> vertical rotation
    targetAngleRef.current = {
      x: (pos.x - 0.5) * Math.PI * 2,  // -PI to PI
      y: (pos.y - 0.5) * -1,           // -0.5 to 0.5 (inverted)
    };
  }, []);

  // Hand tracking hook
  const {
    isReady: handReady,
    isTracking: handTracking,
    error: handError,
    handPosition,
    debug: handDebug,
    startTracking,
    stopTracking,
  } = useHandTracking({
    enabled: handMode,
    onHandMove: handleHandMove,
  });

  // Toggle hand mode
  const toggleHandMode = useCallback(() => {
    if (handMode) {
      stopTracking();
      setHandMode(false);
    } else {
      setHandMode(true);
    }
  }, [handMode, stopTracking]);

  // Auto-start tracking when hand mode enabled and ready
  useEffect(() => {
    if (handMode && handReady && !handTracking) {
      startTracking();
    }
  }, [handMode, handReady, handTracking, startTracking]);

  // Refs for animation loop access
  const hudRef = useRef({
    camDistance: 15, nodeSize: 0.08, rotationSpeed: 0.02,
    linkOpacity: 0.15, breathingIntensity: 0.05,
    ambientLight: 0.8, directLight: 1.2, particleSpeed: 0.3,
    showAllLinks: false, sphereMode: false
  });

  // Type filter ref for animation loop
  const typeFilterRef = useRef<Record<string, boolean>>({ principle: true, learning: true, retro: true });

  // Active node ref for animation loop
  const activeNodeRef = useRef<string | null>(null);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const handModeRef = useRef(false);

  // Reset camera function
  const resetCamera = () => {
    setCamDistance(15);
    camXRef.current = { x: 0, v: 0 };
    camYRef.current = { x: 0, v: 0 };
    targetAngleRef.current = { x: 0, y: 0 };
  };

  // Load file content
  const loadFileContent = async (node: Node) => {
    if (!node.source_file) return;
    setFileLoading(true);
    setShowFilePanel(true);
    try {
      const data = await getFile(node.source_file, node.project);
      setFileContent(data.content || data.error || 'No content');
    } catch (e) {
      setFileContent('Error loading file');
    } finally {
      setFileLoading(false);
    }
  };

  // Close file panel
  const closeFilePanel = () => {
    setShowFilePanel(false);
    setFileContent(null);
  };

  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directLightRef = useRef<THREE.DirectionalLight | null>(null);
  const travelingParticlesRef = useRef<THREE.Points | null>(null);
  const linkMeshesRef = useRef<THREE.Line[]>([]);  // Individual link lines
  const hudHoveredRef = useRef(false);  // Track if mouse is over HUD

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const animationRef = useRef<number>(0);

  // Refs for cleanup (memory leak fix)
  const sharedGeometryRef = useRef<THREE.SphereGeometry | null>(null);
  const particleGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const particleMaterialRef = useRef<THREE.PointsMaterial | null>(null);

  // Camera spring state (separate x and y)
  const camXRef = useRef({ x: 0, v: 0 });
  const camYRef = useRef({ x: 0, v: 0 });
  const targetAngleRef = useRef({ x: 0, y: 0 });

  // Sync HUD state to refs for animation loop
  useEffect(() => {
    hudRef.current = {
      camDistance, nodeSize, rotationSpeed, linkOpacity,
      breathingIntensity, ambientLight, directLight, particleSpeed,
      showAllLinks, sphereMode
    };
    // Update lights
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = ambientLight;
    }
    if (directLightRef.current) {
      directLightRef.current.intensity = directLight;
    }
  }, [camDistance, nodeSize, rotationSpeed, linkOpacity, breathingIntensity, ambientLight, directLight, particleSpeed, showAllLinks, sphereMode]);

  // Sync type filter to ref
  useEffect(() => {
    typeFilterRef.current = typeFilter;
    // Update mesh visibility immediately
    meshesRef.current.forEach(mesh => {
      const nodeType = (mesh.userData.node as Node).type;
      mesh.visible = typeFilter[nodeType] ?? true;
    });
  }, [typeFilter]);

  // Track active node (hovered or selected)
  useEffect(() => {
    activeNodeRef.current = selectedNode?.id || hoveredNode?.id || null;
  }, [hoveredNode, selectedNode]);

  // Sync hand mode to ref
  useEffect(() => { handModeRef.current = handMode; }, [handMode]);

  useEffect(() => {
    loadGraph();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      rendererRef.current?.dispose();
    };
  }, []);

  async function loadGraph() {
    try {
      const data = await getGraph();

      // Save 3D preference - user chose this view
      localStorage.setItem(STORAGE_KEY_VIEW, '3d');

      const clusters = clusterNodes(data.nodes, data.links || []);

      const processedNodes = data.nodes.map((n: Node) => ({
        ...n,
        cluster: clusters.get(n.id) || 0,
      }));

      setNodes(processedNodes);
      setLinks(data.links || []);
    } catch (e) {
      console.error('Failed to load graph:', e);
    } finally {
      setLoading(false);
    }
  }

  // Initialize Three.js
  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 15;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0x606080, hudRef.current.ambientLight);
    scene.add(ambient);
    ambientLightRef.current = ambient;

    const directional = new THREE.DirectionalLight(0xffffff, hudRef.current.directLight);
    directional.position.set(5, 5, 5);
    scene.add(directional);
    directLightRef.current = directional;

    const backLight = new THREE.DirectionalLight(0x4080ff, 0.4);
    backLight.position.set(-5, -3, -5);
    scene.add(backLight);

    // Rim light (purple glow)
    const rimLight = new THREE.PointLight(0xa78bfa, 0.5, 30);
    rimLight.position.set(0, 0, 0);
    scene.add(rimLight);

    // Calculate cluster positions
    const clusterCenters = new Map<number, THREE.Vector3>();
    const maxCluster = Math.max(...nodes.map(n => n.cluster || 0));

    for (let i = 0; i <= maxCluster; i++) {
      const pos = hashOnSphere(42, i * 1000).multiplyScalar(6);  // Centers on surface
      clusterCenters.set(i, pos);
    }

    // Create node meshes
    const geometry = new THREE.SphereGeometry(0.08, 8, 6);
    sharedGeometryRef.current = geometry;  // Store for cleanup
    const meshes: THREE.Mesh[] = [];
    const nodeMap = new Map<string, number>();

    nodes.forEach((node, i) => {
      nodeMap.set(node.id, i);
      const color = TYPE_COLORS[node.type] || 0x888888;
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.3,
        roughness: 0.4,
        emissive: color,
        emissiveIntensity: 0.1,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Cluster position — distributed inside volume
      const cluster = node.cluster || 0;
      const clusterCenter = clusterCenters.get(cluster) || new THREE.Vector3();
      const localPos = hashInSphere(cluster + 100, i).multiplyScalar(2.5);
      const clusterPos = clusterCenter.clone().add(localPos);

      // Sphere mode — on surface with some depth inward
      const raw = xxhash(77, i + 0x20000000);
      const sphereR = (0.7 + 0.3 * raw) * 6;  // 70–100% of radius = surface layer
      const spherePos = hashOnSphere(42, i).multiplyScalar(sphereR);

      mesh.position.copy(clusterPos);
      mesh.userData = {
        node, index: i,
        clusterPos: clusterPos.clone(),
        spherePos: spherePos.clone(),
        currentPos: clusterPos.clone()
      };

      scene.add(mesh);
      meshes.push(mesh);
    });
    meshesRef.current = meshes;

    // Build adjacency map
    const adjacency = new Map<string, Set<string>>();
    nodes.forEach(n => adjacency.set(n.id, new Set()));
    links.forEach(link => {
      adjacency.get(link.source)?.add(link.target);
      adjacency.get(link.target)?.add(link.source);
    });
    adjacencyRef.current = adjacency;

    // Create individual link lines (for per-link visibility control)
    const maxLinks = Math.min(links.length, 1000);
    const linkLines: THREE.Line[] = [];

    interface LinkData {
      sourceIdx: number; targetIdx: number;
      sourceId: string; targetId: string;
      offset: number; speed: number;
      line: THREE.Line;
    }
    const linkDataArray: LinkData[] = [];

    const linkMaterial = new THREE.LineBasicMaterial({
      color: 0xa78bfa,
      opacity: 0,
      transparent: true
    });

    for (let i = 0; i < maxLinks; i++) {
      const link = links[i];
      const srcIdx = nodeMap.get(link.source);
      const tgtIdx = nodeMap.get(link.target);
      if (srcIdx === undefined || tgtIdx === undefined) continue;

      const sourcePos = meshes[srcIdx].position;
      const targetPos = meshes[tgtIdx].position;

      const geometry = new THREE.BufferGeometry().setFromPoints([sourcePos.clone(), targetPos.clone()]);
      const line = new THREE.Line(geometry, linkMaterial.clone());
      line.userData = { sourceIdx: srcIdx, targetIdx: tgtIdx, sourceId: link.source, targetId: link.target };
      scene.add(line);
      linkLines.push(line);

      linkDataArray.push({
        sourceIdx: srcIdx,
        targetIdx: tgtIdx,
        sourceId: link.source,
        targetId: link.target,
        offset: xxhash(42, i + 5000),
        speed: 0.2 + xxhash(42, i + 6000) * 0.3,
        line
      });
    }
    linkMeshesRef.current = linkLines;

    // Traveling particles (hidden by default)
    const particleCount = Math.min(maxLinks, 500);
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometryRef.current = particleGeometry;  // Store for cleanup
    const particlePositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = 0;
      particlePositions[i * 3 + 1] = 0;
      particlePositions[i * 3 + 2] = 0;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.06,
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    particleMaterialRef.current = particleMaterial;  // Store for cleanup

    const travelingParticles = new THREE.Points(particleGeometry, particleMaterial);
    travelingParticles.visible = false;
    scene.add(travelingParticles);
    travelingParticlesRef.current = travelingParticles;

    // Animation
    const handRaycaster = new THREE.Raycaster();
    let time = 0;
    const dt = 1/60;

    function animate() {
      time += 0.016;

      // Spring camera rotation
      camXRef.current = cdsTween(camXRef.current, targetAngleRef.current.x, 3, dt);
      camYRef.current = cdsTween(camYRef.current, targetAngleRef.current.y, 3, dt);

      const camDist = hudRef.current.camDistance;
      camera.position.x = Math.sin(camXRef.current.x) * camDist;
      camera.position.z = Math.cos(camXRef.current.x) * camDist;
      camera.position.y = camYRef.current.x * 5;
      camera.lookAt(0, 0, 0);

      // Breathing animation with noise + sphere/cluster lerp
      const isSphere = hudRef.current.sphereMode;
      meshes.forEach((mesh, i) => {
        const clusterPos = mesh.userData.clusterPos as THREE.Vector3;
        const spherePos = mesh.userData.spherePos as THREE.Vector3;
        const currentPos = mesh.userData.currentPos as THREE.Vector3;

        // Target position based on mode
        const targetPos = isSphere ? spherePos : clusterPos;

        // Smooth lerp to target (spring-like)
        currentPos.lerp(targetPos, 0.05);

        // Apply breathing
        const n = fractalNoise(time * 0.5 + i * 0.1, 2, 42);
        const scale = 1 + n * hudRef.current.breathingIntensity;
        mesh.position.copy(currentPos).multiplyScalar(scale);

        // Update node size
        mesh.scale.setScalar(hudRef.current.nodeSize / 0.08);

        // Gentle rotation
        mesh.rotation.y = time * 0.2 + i * 0.01;
      });

      // Slow global rotation
      scene.rotation.y = time * hudRef.current.rotationSpeed;

      // Update link visibility based on active node and type filter
      const activeId = activeNodeRef.current;
      const showAll = hudRef.current.showAllLinks;
      const currentTypeFilter = typeFilterRef.current;

      let particleIndex = 0;
      const positions = travelingParticles.geometry.attributes.position.array as Float32Array;

      linkDataArray.forEach((linkData) => {
        const mat = linkData.line.material as THREE.LineBasicMaterial;
        const isConnected = activeId && (linkData.sourceId === activeId || linkData.targetId === activeId);

        // Fast path: if no active node and not showing all links, hide everything
        if (!activeId && !showAll) {
          if (mat.opacity !== 0) mat.opacity = 0;
          linkData.line.visible = false;
          return;
        }

        // Check if both source and target nodes are visible (based on type filter)
        const sourceNode = meshes[linkData.sourceIdx]?.userData?.node as Node | undefined;
        const targetNode = meshes[linkData.targetIdx]?.userData?.node as Node | undefined;
        const linkVisible = (currentTypeFilter[sourceNode?.type || ''] ?? true) &&
                           (currentTypeFilter[targetNode?.type || ''] ?? true);

        if (!linkVisible) {
          if (mat.opacity !== 0) mat.opacity = 0;
          linkData.line.visible = false;
          return;
        }

        // Determine opacity
        const targetOpacity = showAll ? 0.04 : isConnected ? hudRef.current.linkOpacity : 0;
        linkData.line.visible = targetOpacity > 0;
        mat.opacity = targetOpacity;

        // Only update geometry for visible links
        if (linkData.line.visible) {
          const srcPos = meshes[linkData.sourceIdx].position;
          const tgtPos = meshes[linkData.targetIdx].position;
          const linePositions = linkData.line.geometry.attributes.position.array as Float32Array;
          linePositions[0] = srcPos.x; linePositions[1] = srcPos.y; linePositions[2] = srcPos.z;
          linePositions[3] = tgtPos.x; linePositions[4] = tgtPos.y; linePositions[5] = tgtPos.z;
          linkData.line.geometry.attributes.position.needsUpdate = true;
        }

        // Animate particles only for connected links
        if (isConnected && particleIndex < 500) {
          const srcPos = meshes[linkData.sourceIdx].position;
          const tgtPos = meshes[linkData.targetIdx].position;
          const t = ((time * linkData.speed * hudRef.current.particleSpeed + linkData.offset) % 1);
          positions[particleIndex * 3] = srcPos.x + (tgtPos.x - srcPos.x) * t;
          positions[particleIndex * 3 + 1] = srcPos.y + (tgtPos.y - srcPos.y) * t;
          positions[particleIndex * 3 + 2] = srcPos.z + (tgtPos.z - srcPos.z) * t;
          particleIndex++;
        }
      });

      // Hide remaining particles
      for (let i = particleIndex; i < 500; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -1000;  // Move off screen
        positions[i * 3 + 2] = 0;
      }

      travelingParticles.visible = !!activeId;
      travelingParticles.geometry.attributes.position.needsUpdate = true;

      // Hand mode: raycast from screen center (hand controls camera, center = pointer)
      if (handModeRef.current) {
        handRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hits = handRaycaster.intersectObjects(meshes);
        if (hits.length > 0) {
          const hovered = hits[0].object.userData.node as Node;
          setHoveredNode(hovered);
          meshes.forEach(m => {
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = m === hits[0].object ? 0.5 : 0.1;
          });
        } else {
          setHoveredNode(null);
          meshes.forEach(m => {
            (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1;
          });
        }
      }

      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    }

    animate();

    // Mouse interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    function onMouseDown(e: MouseEvent) {
      if (hudHoveredRef.current) return;  // Don't start drag if over HUD
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    }

    function onMouseUp() {
      isDragging = false;
      container.style.cursor = 'default';
    }

    function onMouseMove(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;

      // Only rotate camera when dragging
      if (isDragging) {
        const dx = (e.clientX - dragStart.x) * 0.005;
        const dy = (e.clientY - dragStart.y) * 0.003;
        targetAngleRef.current.x += dx;
        targetAngleRef.current.y = Math.max(-0.5, Math.min(0.5, targetAngleRef.current.y - dy));
        dragStart = { x: e.clientX, y: e.clientY };
      }

      // Raycast for hover
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const hovered = intersects[0].object.userData.node as Node;
        setHoveredNode(hovered);
        if (!isDragging) container.style.cursor = 'pointer';

        // Highlight hovered node
        meshes.forEach(m => {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = m === intersects[0].object ? 0.5 : 0.1;
        });
      } else {
        setHoveredNode(null);
        if (!isDragging) container.style.cursor = 'default';
        meshes.forEach(m => {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.1;
        });
      }
    }

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);
    container.addEventListener('mousemove', onMouseMove);

    // Click to lock/unlock selection
    function onClick(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const clicked = intersects[0].object.userData.node as Node;
        // Toggle selection
        setSelectedNode(prev => prev?.id === clicked.id ? null : clicked);
      }
      // Don't clear on empty space - use Escape or double-click
    }

    // Double click to clear selection
    function onDblClick() {
      setSelectedNode(null);
    }

    container.addEventListener('click', onClick);
    container.addEventListener('dblclick', onDblClick);

    // Wheel zoom
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.5 : -1.5;
      setCamDistance(prev => Math.max(5, Math.min(50, prev + delta)));
    }
    container.addEventListener('wheel', onWheel, { passive: false });

    // Resize handler
    function onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    return () => {
      // Remove event listeners
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mouseleave', onMouseUp);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);

      // Cancel animation
      if (animationRef.current) cancelAnimationFrame(animationRef.current);

      // Dispose node meshes and materials
      meshes.forEach(mesh => {
        (mesh.material as THREE.Material).dispose();
        scene.remove(mesh);
      });

      // Dispose shared geometry
      if (sharedGeometryRef.current) {
        sharedGeometryRef.current.dispose();
        sharedGeometryRef.current = null;
      }

      // Dispose link lines
      linkLines.forEach(line => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        scene.remove(line);
      });
      linkMeshesRef.current = [];

      // Dispose particle system
      if (particleGeometryRef.current) {
        particleGeometryRef.current.dispose();
        particleGeometryRef.current = null;
      }
      if (particleMaterialRef.current) {
        particleMaterialRef.current.dispose();
        particleMaterialRef.current = null;
      }
      if (travelingParticlesRef.current) {
        scene.remove(travelingParticlesRef.current);
        travelingParticlesRef.current = null;
      }

      // Remove renderer DOM element and dispose
      container.removeChild(renderer.domElement);
      renderer.dispose();

      // Clear refs
      meshesRef.current = [];
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [nodes, links]);

  if (loading) {
    return <div className={styles.loading}>Loading 3D graph...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Knowledge Graph 3D</h1>
        <div className={styles.stats}>
          {nodes.length} nodes · {links.length} links
          <button
            onClick={() => {
              localStorage.setItem(STORAGE_KEY_VIEW, '2d');
              navigate('/graph');
            }}
            style={{
              marginLeft: '10px',
              background: 'rgba(167, 139, 250, 0.2)',
              border: '1px solid #a78bfa',
              borderRadius: '4px',
              color: '#a78bfa',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            ← 2D View
          </button>
        </div>
      </div>

      <div className={styles.legend}>
        {(() => {
          // Count nodes by type
          const counts: Record<string, number> = {};
          nodes.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });

          const typeConfig = [
            { key: 'principle', label: 'Principle', color: '#a78bfa' },
            { key: 'learning', label: 'Learning', color: '#4ade80' },
            { key: 'retro', label: 'Retro', color: '#60a5fa' },
          ];

          return typeConfig.map(({ key, label, color }) => {
            const count = counts[key] || 0;
            if (count === 0) return null;  // Hide types with no data

            return (
              <button
                key={key}
                className={`${styles.legendItem} ${!typeFilter[key] ? styles.legendItemDisabled : ''}`}
                onClick={() => setTypeFilter(prev => ({ ...prev, [key]: !prev[key] }))}
                style={{
                  opacity: typeFilter[key] ? 1 : 0.4,
                  cursor: 'pointer',
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#e0e0e0',
                  fontSize: '13px'
                }}
              >
                <span className={styles.dot} style={{ background: color }}></span>
                {label} ({count})
              </button>
            );
          });
        })()}
      </div>

      <div className={styles.controls}>
        <span className={styles.hint}>
          Drag to rotate • Scroll to zoom • Click to select
          {selectedNode && <strong> • {selectedNode.type}: {selectedNode.label?.slice(0, 30) || 'Unknown'}...</strong>}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={toggleHandMode}
            className={styles.hudToggle}
            style={{
              background: handTracking ? '#4ade80' : undefined,
              color: handTracking ? '#000' : undefined
            }}
          >
            {handTracking ? '✋ Hand ON' : '✋ Hand'}
          </button>
          <button onClick={resetCamera} className={styles.hudToggle}>Reset</button>
          <button
            onClick={() => setShowHud(!showHud)}
            className={styles.hudToggle}
          >
            {showHud ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className={styles.canvas}>
        {showHud && (
          <div
              className={styles.hud}
              onMouseEnter={() => { hudHoveredRef.current = true; }}
              onMouseLeave={() => { hudHoveredRef.current = false; }}
            >
            <div className={styles.hudTitle}>Controls</div>

            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <input
                type="checkbox"
                checked={sphereMode}
                onChange={(e) => setSphereMode(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ color: '#a78bfa' }}>Sphere Mode</span>
            </label>

            <label className={styles.hudLabel}>
              Camera Distance: {camDistance}
              <input
                type="range"
                min="5"
                max="40"
                step="1"
                value={camDistance}
                onChange={(e) => setCamDistance(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Node Size: {nodeSize.toFixed(2)}
              <input
                type="range"
                min="0.02"
                max="0.2"
                step="0.01"
                value={nodeSize}
                onChange={(e) => setNodeSize(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Rotation Speed: {rotationSpeed.toFixed(3)}
              <input
                type="range"
                min="0"
                max="0.1"
                step="0.005"
                value={rotationSpeed}
                onChange={(e) => setRotationSpeed(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Link Opacity: {linkOpacity.toFixed(2)}
              <input
                type="range"
                min="0"
                max="0.3"
                step="0.01"
                value={linkOpacity}
                onChange={(e) => setLinkOpacity(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Breathing: {breathingIntensity.toFixed(2)}
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={breathingIntensity}
                onChange={(e) => setBreathingIntensity(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <div className={styles.hudDivider}>Lighting</div>

            <label className={styles.hudLabel}>
              Ambient: {ambientLight.toFixed(1)}
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={ambientLight}
                onChange={(e) => setAmbientLight(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Direct: {directLight.toFixed(1)}
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={directLight}
                onChange={(e) => setDirectLight(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <div className={styles.hudDivider}>Links</div>

            <label className={styles.hudLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={showAllLinks}
                onChange={(e) => setShowAllLinks(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              Show All Links
            </label>

            <label className={styles.hudLabel}>
              Particle Speed: {particleSpeed.toFixed(2)}
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={particleSpeed}
                onChange={(e) => setParticleSpeed(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>

            <label className={styles.hudLabel}>
              Link Opacity: {linkOpacity.toFixed(2)}
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={linkOpacity}
                onChange={(e) => setLinkOpacity(Number(e.target.value))}
                className={styles.hudSlider}
              />
            </label>
          </div>
        )}
      </div>

      {(hoveredNode || selectedNode) && !showFilePanel && (
        <div className={styles.tooltip} style={{ maxWidth: '350px' }}>
          <span className={styles.nodeType}>
            {selectedNode ? `🔒 ${selectedNode.type}` : hoveredNode?.type}
          </span>
          <p className={styles.nodeLabel} style={{
            fontSize: '14px',
            fontWeight: 'bold',
            margin: '8px 0',
            lineHeight: '1.4',
            color: '#e0e0e0'
          }}>
            {(selectedNode || hoveredNode)?.label ||
             (selectedNode || hoveredNode)?.source_file?.split('/').pop()?.replace(/\.md$/, '').replace(/-/g, ' ') ||
             'Untitled'}
          </p>
          {(selectedNode || hoveredNode)?.source_file && (
            <p style={{ fontSize: '11px', margin: '4px 0', wordBreak: 'break-all' }}>
              📄{' '}
              {selectedNode ? (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); loadFileContent(selectedNode); }}
                  style={{ color: '#a78bfa', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {selectedNode.source_file?.split('/').pop()}
                </a>
              ) : (
                <span style={{ color: '#888' }}>{hoveredNode?.source_file?.split('/').pop()}</span>
              )}
            </p>
          )}
          {(selectedNode || hoveredNode)?.concepts && (selectedNode || hoveredNode)!.concepts!.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '8px 0' }}>
              {(selectedNode || hoveredNode)!.concepts!.slice(0, 5).map((c, i) => (
                <span key={i} style={{
                  background: 'rgba(167, 139, 250, 0.2)',
                  color: '#a78bfa',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px'
                }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* File Content Panel */}
      {showFilePanel && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '20px',
          right: '300px',
          bottom: '20px',
          background: 'rgba(15, 15, 25, 0.95)',
          borderRadius: '12px',
          padding: '20px',
          overflow: 'auto',
          border: '1px solid rgba(167, 139, 250, 0.3)',
          zIndex: 100
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ color: '#a78bfa', margin: 0, fontSize: '14px' }}>
              {selectedNode?.source_file?.split('/').pop() || 'File'}
            </h3>
            <button
              onClick={closeFilePanel}
              style={{
                background: 'transparent',
                border: '1px solid #666',
                borderRadius: '4px',
                color: '#888',
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Close
            </button>
          </div>
          {fileLoading ? (
            <p style={{ color: '#888' }}>Loading...</p>
          ) : (
            <pre style={{
              color: '#e0e0e0',
              fontSize: '12px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              fontFamily: 'monospace'
            }}>
              {fileContent}
            </pre>
          )}
        </div>
      )}

      {/* Hand Tracking Status */}
      {handMode && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          background: 'rgba(15, 15, 25, 0.9)',
          borderRadius: '8px',
          padding: '12px',
          border: '1px solid rgba(74, 222, 128, 0.3)',
          zIndex: 100,
          minWidth: '150px'
        }}>
          <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>
            ✋ Hand Tracking
          </div>
          <div style={{ color: '#888', fontSize: '10px', marginBottom: '4px' }}>{handDebug}</div>
          {handError ? (
            <div style={{ color: '#f87171', fontSize: '11px' }}>{handError}</div>
          ) : !handTracking ? (
            <div style={{ color: '#888', fontSize: '11px' }}>Starting...</div>
          ) : handPosition ? (
            <div style={{ color: '#e0e0e0', fontSize: '11px' }}>
              X: {(handPosition.x * 100).toFixed(0)}% | Y: {(handPosition.y * 100).toFixed(0)}%
              <div style={{
                width: '100%',
                height: '60px',
                background: '#1a1a2e',
                borderRadius: '4px',
                marginTop: '8px',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  left: `${handPosition.x * 100}%`,
                  top: `${handPosition.y * 100}%`,
                  width: '12px',
                  height: '12px',
                  background: '#4ade80',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 10px #4ade80'
                }} />
              </div>
            </div>
          ) : (
            <div style={{ color: '#888', fontSize: '11px' }}>Show your hand to camera</div>
          )}
        </div>
      )}
    </div>
  );
}
