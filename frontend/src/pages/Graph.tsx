import { useState, useEffect } from 'react';
import { getGraph } from '../api/oracle';
import type { GraphNode, GraphLink } from '../utils/graphTypes';
import { STORAGE_KEY_VIEW } from '../utils/graphTypes';
import { clusterNodes } from '../utils/graphClustering';
import { Canvas2D } from '../components/Canvas2D';
import { Canvas3D } from '../components/Canvas3D';
import styles from './Graph.module.css';

export function Graph() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allLinks, setAllLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    return saved === '2d' ? '2d' : '3d';
  });

  useEffect(() => {
    loadGraph();
  }, []);

  async function loadGraph() {
    try {
      const data = await getGraph();
      const clusters = clusterNodes(
        data.nodes as GraphNode[],
        data.links || []
      );
      const width = 800, height = 600;
      const centerX = width / 2, centerY = height / 2;

      const processedNodes = data.nodes.map((n) => ({
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
