import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getMap, getStats, search } from '../api/oracle';
import type { MapDocument, Stats } from '../api/oracle';
import styles from './Map.module.css';

const TYPE_COLORS: Record<string, string> = {
  principle: '#60a5fa',
  learning: '#a78bfa',
  retro: '#fbbf24',
  unknown: '#666666',
};

const TYPE_COLORS_NUM: Record<string, number> = {
  principle: 0x60a5fa,
  learning: 0xa78bfa,
  retro: 0xfbbf24,
  unknown: 0x666666,
};

// Damped spring tween (from Graph.tsx pattern)
function cdsTween(state: { x: number; v: number }, target: number, speed: number, dt: number) {
  const n1 = state.v - (state.x - target) * (speed * speed * dt);
  const n2 = 1 + speed * dt;
  const nv = n1 / (n2 * n2);
  return { x: state.x + nv * dt, v: nv };
}

// Noise functions (ported from Graph.tsx for breathing animation)
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

// Age-based scale factor for node size variation
function ageScale(createdAt: string | null): number {
  if (!createdAt) return 0.7;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 7) return 1.3;
  if (ageDays < 30) return 1.0;
  return 0.7;
}

export function Map() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [documents, setDocuments] = useState<MapDocument[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIds, setMatchIds] = useState<Set<string>>(new Set());
  const [hoveredDoc, setHoveredDoc] = useState<MapDocument | null>(null);
  const [searching, setSearching] = useState(false);

  const matchIdsRef = useRef<Set<string>>(new Set());
  const hoveredDocRef = useRef<MapDocument | null>(null);
  const animRef = useRef<number>(0);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mouseNDC = useRef(new THREE.Vector2(10, 10));
  const labelsRef = useRef<HTMLDivElement>(null);

  // Camera orbit state
  const camAngleX = useRef({ x: 0, v: 0 });
  const camAngleY = useRef({ x: 0.3, v: 0 });
  const camDist = useRef({ x: 18, v: 0 });
  const targetAngleX = useRef(0);
  const targetAngleY = useRef(0.3);
  const targetDist = useRef(18);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => { matchIdsRef.current = matchIds; }, [matchIds]);
  useEffect(() => { hoveredDocRef.current = hoveredDoc; }, [hoveredDoc]);

  // Load data
  useEffect(() => {
    Promise.all([
      getMap().catch(() => ({ documents: [], total: 0 })),
      getStats().catch(() => null),
    ]).then(([mapData, statsData]) => {
      setDocuments(mapData.documents);
      setStats(statsData);
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, []);

  // Three.js scene setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container || documents.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020208);
    sceneRef.current = scene;

    // Camera — wider FOV, pulled back to see full cloud
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
    camera.position.z = 16;
    cameraRef.current = camera;

    // Renderer — tone mapping for bloom
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing: bloom
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.8,   // strength
      0.4,   // radius
      0.2,   // threshold — low so emissive nodes glow
    );
    composer.addPass(bloomPass);

    // Lighting — dimmer, let emissive + bloom carry the look
    const ambient = new THREE.AmbientLight(0x404060, 0.4);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(5, 5, 5);
    scene.add(directional);

    // Star field background
    const starCount = 2000;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let si = 0; si < starCount; si++) {
      starPositions[si * 3] = (Math.random() - 0.5) * 80;
      starPositions[si * 3 + 1] = (Math.random() - 0.5) * 80;
      starPositions[si * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.04,
      transparent: true,
      opacity: 0.6,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Wireframe globe — subtle reference frame
    const globeRadius = 10;
    const globeGeometry = new THREE.SphereGeometry(globeRadius, 32, 24);
    const globeWireframe = new THREE.WireframeGeometry(globeGeometry);
    const globeMaterial = new THREE.LineBasicMaterial({
      color: 0x6a5acd,
      opacity: 0.06,
      transparent: true,
    });
    const globeMesh = new THREE.LineSegments(globeWireframe, globeMaterial);
    scene.add(globeMesh);

    // Node geometry (shared)
    const nodeGeometry = new THREE.SphereGeometry(0.05, 10, 10);
    const meshes: THREE.Mesh[] = [];

    // Reduced motion preference
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Position nodes — spread across full globe volume
    documents.forEach((doc, i) => {
      const color = TYPE_COLORS_NUM[doc.type] || TYPE_COLORS_NUM.unknown;
      const baseScale = ageScale(doc.created_at);
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.3,
        roughness: 0.2,
        emissive: color,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 1.0,
      });

      const mesh = new THREE.Mesh(nodeGeometry, material);
      // Use xxhash for deterministic z based on node index
      const z = (xxhash(7, i) - 0.5) * 2; // ±1 normalized
      const basePos = new THREE.Vector3(
        doc.x * 8,
        doc.y * 8,
        z * 5,
      );
      mesh.position.copy(basePos);
      mesh.userData = { doc, basePos, baseScale };
      scene.add(mesh);
      meshes.push(mesh);
    });
    meshesRef.current = meshes;

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(10, 10);

    // Mouse handlers
    function onMouseDown(e: MouseEvent) {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
    }

    function onMouseUp(e: MouseEvent) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const wasDrag = Math.abs(dx) > 3 || Math.abs(dy) > 3;

      if (!wasDrag) {
        // Click — check for node
        const rect = container!.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(meshes);
        if (intersects.length > 0) {
          const doc = intersects[0].object.userData.doc as MapDocument;
          navigate(`/doc/${encodeURIComponent(doc.id)}`);
        }
      }
      isDragging.current = false;
    }

    function onMouseMove(e: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      // Always track NDC for dock magnification
      mouseNDC.current.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouseNDC.current.y = -((e.clientY - rect.top) / height) * 2 + 1;

      if (isDragging.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        targetAngleX.current = camAngleX.current.x + dx * 0.005;
        targetAngleY.current = Math.max(-1.2, Math.min(1.2, camAngleY.current.x - dy * 0.005));
        return;
      }

      // Hover detection
      mouse.x = mouseNDC.current.x;
      mouse.y = mouseNDC.current.y;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const doc = intersects[0].object.userData.doc as MapDocument;
        setHoveredDoc(doc);
        container!.style.cursor = 'pointer';
      } else {
        setHoveredDoc(null);
        container!.style.cursor = isDragging.current ? 'grabbing' : 'grab';
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.08 : 0.92;
      targetDist.current = Math.max(5, Math.min(30, targetDist.current * delta));
    }

    function onMouseLeave() {
      isDragging.current = false;
      setHoveredDoc(null);
      mouseNDC.current.set(10, 10); // move offscreen
    }

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mouseleave', onMouseLeave);

    // Resize handler
    function onResize() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // Proximity label pool (imperatively managed for perf)
    const LABEL_POOL_SIZE = 8;
    const labelPool: HTMLDivElement[] = [];
    const labelsContainer = labelsRef.current;
    if (labelsContainer) {
      for (let i = 0; i < LABEL_POOL_SIZE; i++) {
        const el = document.createElement('div');
        el.className = styles.proximityLabel;
        el.style.display = 'none';
        labelsContainer.appendChild(el);
        labelPool.push(el);
      }
    }

    // Animation loop
    let time = 0;
    const dt = 1 / 60;
    const tempVec = new THREE.Vector3();
    const aspectRatio = width / height;

    function animate() {
      time += 0.016;

      // Slow celestial rotation when not dragging
      if (!isDragging.current && !prefersReduced) {
        targetAngleX.current += 0.0005;
      }

      // Smooth camera orbit
      camAngleX.current = cdsTween(camAngleX.current, targetAngleX.current, 3, dt);
      camAngleY.current = cdsTween(camAngleY.current, targetAngleY.current, 3, dt);
      camDist.current = cdsTween(camDist.current, targetDist.current, 4, dt);

      const dist = camDist.current.x;
      camera.position.x = Math.sin(camAngleX.current.x) * Math.cos(camAngleY.current.x) * dist;
      camera.position.y = Math.sin(camAngleY.current.x) * dist;
      camera.position.z = Math.cos(camAngleX.current.x) * Math.cos(camAngleY.current.x) * dist;
      camera.lookAt(0, 0, 0);

      // Globe slow rotation
      globeMesh.rotation.y = time * 0.02;
      globeMesh.rotation.x = time * 0.005;

      // Update node materials based on search/hover + breathing + dock magnification
      const matches = matchIdsRef.current;
      const hasSearch = matches.size > 0;
      const hovered = hoveredDocRef.current;
      const mx = mouseNDC.current.x;
      const my = mouseNDC.current.y;

      // Collect nearby nodes for proximity labels
      const nearby: { screenDist: number; ndcX: number; ndcY: number; doc: MapDocument; color: string }[] = [];

      meshes.forEach((mesh, i) => {
        const doc = mesh.userData.doc as MapDocument;
        const basePos = mesh.userData.basePos as THREE.Vector3;
        const baseScale = mesh.userData.baseScale as number;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const isMatched = hasSearch && matches.has(doc.id);
        const isFaded = hasSearch && !isMatched;

        // Breathing — gentle per-axis drift (galaxy float, not atomic pulse)
        if (!prefersReduced) {
          const t = time * 0.15;
          const dx = fractalNoise(t + i * 0.17, 2, 42) * 0.12;
          const dy = fractalNoise(t + i * 0.23, 2, 97) * 0.12;
          const dz = fractalNoise(t + i * 0.31, 2, 163) * 0.06;
          mesh.position.set(basePos.x + dx, basePos.y + dy, basePos.z + dz);
        }

        // Dock magnification — smooth proximity swell
        tempVec.copy(mesh.position).project(camera);
        const screenDist = Math.sqrt(
          Math.pow((tempVec.x - mx) * aspectRatio, 2) +
          Math.pow(tempVec.y - my, 2)
        );
        const magnifyRadius = 0.5;
        const magnifyFactor = screenDist < magnifyRadius
          ? 1 + 0.6 * Math.pow(1 - screenDist / magnifyRadius, 2)
          : 1;

        // Scale: age-based × magnification × search boost
        let scale = baseScale * magnifyFactor;
        if (isMatched) scale *= 1.4;
        mesh.scale.setScalar(scale);

        // Dynamic emissive glow — proximity + search state
        const baseGlow = isFaded ? 0.1 : 0.5;
        mat.emissiveIntensity = baseGlow + (magnifyFactor - 1) * 0.6;
        if (isMatched) mat.emissiveIntensity = 1.0;
        if (hovered?.id === doc.id) mat.emissiveIntensity = 1.2;

        mat.opacity = isFaded ? 0.05 : 1.0;

        // Track nearby nodes for labels (skip faded)
        if (!isFaded && screenDist < 0.5 && tempVec.z < 1) {
          nearby.push({
            screenDist,
            ndcX: tempVec.x,
            ndcY: tempVec.y,
            doc,
            color: TYPE_COLORS[doc.type] || TYPE_COLORS.unknown,
          });
        }
      });

      // Position proximity labels
      nearby.sort((a, b) => a.screenDist - b.screenDist);
      for (let li = 0; li < labelPool.length; li++) {
        const el = labelPool[li];
        if (li < nearby.length) {
          const n = nearby[li];
          const px = (n.ndcX + 1) * 0.5 * width;
          const py = (1 - (n.ndcY + 1) * 0.5) * height;
          const opacity = Math.max(0.3, 1 - n.screenDist / 0.5);
          el.textContent = extractTitle(n.doc.source_file);
          el.style.left = `${px + 10}px`;
          el.style.top = `${py - 8}px`;
          el.style.opacity = String(opacity);
          el.style.color = n.color;
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      }

      composer.render();
      animRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      labelPool.forEach(el => el.remove());
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('resize', onResize);

      meshes.forEach((mesh) => {
        (mesh.material as THREE.Material).dispose();
        scene.remove(mesh);
      });
      nodeGeometry.dispose();
      globeWireframe.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
      starGeo.dispose();
      starMat.dispose();
      composer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [documents, navigate]);

  // Search
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setMatchIds(new Set());
      return;
    }
    setSearching(true);
    try {
      const data = await search(searchQuery, 'all', 50, 'hybrid');
      setMatchIds(new Set(data.results.map(r => r.id)));
    } finally {
      setSearching(false);
    }
  }

  // Type counts
  const typeCounts = documents.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>Loading knowledge map...</div>
        <div className={styles.loadingHint}>Computing 3D projection from embeddings</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.errorText}>Failed to load map: {error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.mapArea}>
        <form onSubmit={handleSearch} className={styles.searchOverlay}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search to highlight region..."
            className={styles.searchInput}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setMatchIds(new Set()); }}
              className={styles.clearBtn}
            >
              Clear
            </button>
          )}
          {searching && <span className={styles.searchingDot} />}
        </form>

        <div ref={containerRef} className={styles.threeCanvas} />
        <div ref={labelsRef} className={styles.labelsOverlay} />

        {documents.length === 0 && (
          <div className={styles.emptyOverlay}>
            <div className={styles.emptyTitle}>No Embeddings Yet</div>
            <div className={styles.emptyHint}>
              The 3D map requires vector embeddings from ChromaDB.<br />
              Run a vector index to populate the map.
            </div>
          </div>
        )}

        {hoveredDoc && (
          <div className={styles.tooltip}>
            <div className={styles.tooltipType} style={{ color: TYPE_COLORS[hoveredDoc.type] }}>
              {hoveredDoc.type}
            </div>
            <div className={styles.tooltipTitle}>{extractTitle(hoveredDoc.source_file)}</div>
            {hoveredDoc.concepts.length > 0 && (
              <div className={styles.tooltipConcepts}>
                {hoveredDoc.concepts.slice(0, 4).join(', ')}
              </div>
            )}
          </div>
        )}

        <div className={styles.legend}>
          {Object.entries(TYPE_COLORS).filter(([k]) => k !== 'unknown').map(([type, color]) => (
            <span key={type} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: color }} />
              {type}
            </span>
          ))}
        </div>

        <div className={styles.zoomControls}>
          <button
            onClick={() => { targetDist.current = Math.max(5, targetDist.current * 0.75); }}
            className={styles.zoomBtn}
          >+</button>
          <button
            onClick={() => { targetDist.current = Math.min(30, targetDist.current * 1.35); }}
            className={styles.zoomBtn}
          >-</button>
          <button
            onClick={() => {
              targetAngleX.current = 0;
              targetAngleY.current = 0.3;
              targetDist.current = 18;
            }}
            className={styles.zoomBtn}
            title="Reset view"
          >R</button>
        </div>
      </div>

      <div className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Knowledge Map</h2>
        <div className={styles.statsList}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{documents.length.toLocaleString()}</span>
            <span className={styles.statLabel}>Documents Mapped</span>
          </div>
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} className={styles.statItem}>
              <span className={styles.statValue} style={{ color: TYPE_COLORS[type] }}>{count.toLocaleString()}</span>
              <span className={styles.statLabel}>{type}s</span>
            </div>
          ))}
          {stats?.vector && (
            <>
              <div className={styles.divider} />
              <div className={styles.statItem}>
                <span className={styles.statValue}>{stats.vector.count.toLocaleString()}</span>
                <span className={styles.statLabel}>Embeddings</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{stats.vector.enabled ? 'Active' : 'Offline'}</span>
                <span className={styles.statLabel}>Vector DB</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{stats.vector.collection}</span>
                <span className={styles.statLabel}>Collection</span>
              </div>
            </>
          )}
          {matchIds.size > 0 && (
            <>
              <div className={styles.divider} />
              <div className={styles.statItem}>
                <span className={styles.statValue} style={{ color: '#4ade80' }}>{matchIds.size}</span>
                <span className={styles.statLabel}>Search Matches</span>
              </div>
            </>
          )}
        </div>
        <div className={styles.sidebarHint}>
          Drag to orbit. Scroll to zoom. Click a node to view.
        </div>
      </div>
    </div>
  );
}

function extractTitle(sourceFile: string): string {
  const parts = sourceFile.split('/');
  const filename = parts[parts.length - 1] || sourceFile;
  return filename.replace(/\.md$/, '').replace(/_/g, ' ');
}
