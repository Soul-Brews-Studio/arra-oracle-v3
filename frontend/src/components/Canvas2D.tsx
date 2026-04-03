import { useState, useEffect, useRef } from 'react';
import type { GraphNode, GraphLink } from '../utils/graphTypes';
import {
  TYPE_COLORS_HEX,
  DEFAULT_NODE_LIMIT,
  STORAGE_KEY_FULL,
} from '../utils/graphTypes';
import styles from '../pages/Graph.module.css';

interface Canvas2DProps {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function Canvas2D({ nodes: allNodes, links: allLinks }: Canvas2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showFull, setShowFull] = useState(() => localStorage.getItem(STORAGE_KEY_FULL) === 'true');
  const animationRef = useRef<number>(0);

  // Viewport transform for pan/zoom
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const localNodesRef = useRef<GraphNode[]>([]);

  useEffect(() => {
    applyNodeLimit(allNodes, allLinks, showFull);
  }, [allNodes, allLinks, showFull]);

  function applyNodeLimit(nodeList: GraphNode[], linkList: GraphLink[], full: boolean) {
    if (full || nodeList.length <= DEFAULT_NODE_LIMIT) {
      setNodes(nodeList);
      setLinks(linkList);
    } else {
      const byType: Record<string, GraphNode[]> = {};
      nodeList.forEach(n => {
        if (!byType[n.type]) byType[n.type] = [];
        byType[n.type].push(n);
      });
      const types = Object.keys(byType);
      const perType = Math.floor(DEFAULT_NODE_LIMIT / types.length);
      const limitedNodes: GraphNode[] = [];
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

  // Convert screen coordinates to canvas/simulation coordinates
  function screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: screenX, y: screenY };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const vp = viewportRef.current;
    return {
      x: ((screenX - rect.left) * scaleX - vp.x) / vp.scale,
      y: ((screenY - rect.top) * scaleY - vp.y) / vp.scale,
    };
  }

  useEffect(() => {
    if (nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle resize
    function resizeCanvas() {
      const wrapper = wrapperRef.current;
      if (!wrapper || !canvas) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = wrapper.clientWidth * dpr;
      canvas.height = wrapper.clientHeight * dpr;
      canvas.style.width = wrapper.clientWidth + 'px';
      canvas.style.height = wrapper.clientHeight + 'px';
    }
    resizeCanvas();

    const width = canvas.width, height = canvas.height;
    let localNodes = [...nodes];
    localNodesRef.current = localNodes;
    let time = 0;
    let revealProgress = 0;
    const revealDuration = 10;

    // Center viewport initially
    viewportRef.current = { x: 0, y: 0, scale: 1 };

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
      if (!ctx || !canvas) return;
      const vp = viewportRef.current;

      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.scale, vp.scale);

      const visibleLinks = Math.floor(links.length * revealProgress);
      ctx.lineWidth = 0.5 / vp.scale;
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
        ctx.arc(source.x! + (target.x! - source.x!) * t, source.y! + (target.y! - source.y!) * t, 1.5 / vp.scale, 0, Math.PI * 2);
        ctx.fill();
      });

      const nodeAlpha = Math.min(1, revealProgress * 3);
      const nodeRadius = 4 / Math.max(1, vp.scale * 0.8);
      localNodes.forEach(node => {
        const color = TYPE_COLORS_HEX[node.type] || '#888';
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${nodeAlpha})`;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    }

    // Mouse drag to pan
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    function onMouseDown(e: MouseEvent) {
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      if (canvas) canvas.style.cursor = 'grabbing';
    }

    function onMouseUp() {
      isDragging = false;
      if (canvas) canvas.style.cursor = 'grab';
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      viewportRef.current.x += (e.clientX - dragStart.x) * dpr;
      viewportRef.current.y += (e.clientY - dragStart.y) * dpr;
      dragStart = { x: e.clientX, y: e.clientY };
    }

    // Wheel to zoom (zoom toward cursor)
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const mouseX = (e.clientX - rect.left) * dpr;
      const mouseY = (e.clientY - rect.top) * dpr;
      const vp = viewportRef.current;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(5, vp.scale * zoomFactor));
      const ratio = newScale / vp.scale;

      vp.x = mouseX - (mouseX - vp.x) * ratio;
      vp.y = mouseY - (mouseY - vp.y) * ratio;
      vp.scale = newScale;
    }

    // Touch support
    let touchStartDistance = 0;
    let lastTouchPos = { x: 0, y: 0 };
    let isTouching = false;
    let touchStartTime = 0;
    let touchStartPos = { x: 0, y: 0 };

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      if (e.touches.length === 1) {
        isTouching = true;
        touchStartTime = Date.now();
        lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchStartPos = { ...lastTouchPos };
      } else if (e.touches.length === 2) {
        isTouching = false;
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        touchStartDistance = Math.sqrt(dx * dx + dy * dy);
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (e.touches.length === 1 && isTouching) {
        viewportRef.current.x += (e.touches[0].clientX - lastTouchPos.x) * dpr;
        viewportRef.current.y += (e.touches[0].clientY - lastTouchPos.y) * dpr;
        lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) * dpr;
        const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) * dpr;

        const vp = viewportRef.current;
        const zoomFactor = distance / touchStartDistance;
        const newScale = Math.max(0.3, Math.min(5, vp.scale * zoomFactor));
        const ratio = newScale / vp.scale;

        vp.x = midX - (midX - vp.x) * ratio;
        vp.y = midY - (midY - vp.y) * ratio;
        vp.scale = newScale;

        touchStartDistance = distance;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (isTouching && e.changedTouches.length > 0) {
        const elapsed = Date.now() - touchStartTime;
        const dx = e.changedTouches[0].clientX - touchStartPos.x;
        const dy = e.changedTouches[0].clientY - touchStartPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (elapsed < 300 && dist < 10) {
          const pos = screenToCanvas(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
          const hitRadius = 15 / viewportRef.current.scale;
          const tapped = localNodesRef.current.find(n =>
            Math.sqrt((n.x! - pos.x) ** 2 + (n.y! - pos.y) ** 2) < hitRadius
          );
          setSelectedNode(tapped || null);
        }
      }
      isTouching = false;
    }

    function onResize() {
      resizeCanvas();
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    window.addEventListener('resize', onResize);
    canvas.style.cursor = 'grab';

    simulate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
    };
  }, [nodes, links]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = screenToCanvas(e.clientX, e.clientY);
    const hitRadius = 15 / viewportRef.current.scale;
    const clicked = localNodesRef.current.find(n =>
      Math.sqrt((n.x! - pos.x) ** 2 + (n.y! - pos.y) ** 2) < hitRadius
    );
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
      <div className={styles.controls}>
        <span className={styles.hint}>
          Drag to pan • Scroll to zoom • Click to select
          {selectedNode && <strong> • {selectedNode.type}: {selectedNode.label?.slice(0, 30) || 'Unknown'}</strong>}
        </span>
        <button
          onClick={() => { viewportRef.current = { x: 0, y: 0, scale: 1 }; }}
          className={styles.hudToggle}
        >
          Reset View
        </button>
      </div>
      <div ref={wrapperRef} className={styles.canvasWrapper} style={{ width: '100%', height: 'calc(100vh - 200px)' }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick} className={styles.canvas} style={{ touchAction: 'none', cursor: 'grab' }} />
      </div>
      {selectedNode && (
        <div className={styles.nodeInfo}>
          <span className={styles.nodeType}>{selectedNode.type}</span>
          <p className={styles.nodeLabel}>{selectedNode.label}</p>
          {selectedNode.source_file && (
            <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
              📄 {selectedNode.source_file}
            </p>
          )}
          {selectedNode.concepts && selectedNode.concepts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
              {selectedNode.concepts.slice(0, 8).map((c, i) => (
                <span key={i} style={{
                  background: 'rgba(167, 139, 250, 0.2)',
                  color: '#a78bfa',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px'
                }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
