import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getStats, reflect, stripProjectPrefix } from '../api/oracle';
import type { Document, Stats } from '../api/oracle';
import styles from './Overview.module.css';

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [wisdom, setWisdom] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setConnectionError(null);
      const [statsData, wisdomData] = await Promise.all([
        getStats(),
        reflect()
      ]);
      // Verify we got valid data (not empty/error response)
      if (!statsData || (statsData.total === 0 && !statsData.by_type)) {
        setConnectionError('Backend returned empty data. Server may need restarting.');
      }
      setStats(statsData);
      // Only set wisdom if it has content (not an error response)
      if (wisdomData && 'content' in wisdomData) {
        setWisdom(wisdomData);
      }
    } catch (e) {
      console.error('Failed to load stats:', e);
      setConnectionError('Cannot connect to Oracle backend. Run: bun run server');
    } finally {
      setLoading(false);
    }
  }

  async function refreshWisdom() {
    const data = await reflect();
    // Only set wisdom if it has content (not an error response)
    if (data && 'content' in data) {
      setWisdom(data);
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Oracle Overview</h1>
      <p className={styles.subtitle}>Your knowledge base at a glance</p>

      {connectionError && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: '#ef4444'
        }}>
          <strong>Connection Error:</strong> {connectionError}
          <br />
          <code style={{ fontSize: '12px', opacity: 0.8 }}>
            bun run server
          </code>
        </div>
      )}

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.total?.toLocaleString() || 0}</div>
          <div className={styles.statLabel}>Documents</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{(stats?.by_type?.learning || 0).toLocaleString()}</div>
          <div className={styles.statLabel}>Learnings</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{(stats?.by_type?.retro || 0).toLocaleString()}</div>
          <div className={styles.statLabel}>Retros</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.by_type?.principle || 0}</div>
          <div className={styles.statLabel}>Principles</div>
        </div>
        <div className={`${styles.statCard} ${stats?.is_stale ? '' : styles.healthy}`}>
          <div className={styles.statValue}>{stats?.is_stale ? 'Stale' : 'Healthy'}</div>
          <div className={styles.statLabel}>Status</div>
        </div>
        {stats?.vector && (
          <div className={`${styles.statCard} ${stats.vector.enabled ? styles.healthy : ''}`}>
            <div className={styles.statValue}>{stats.vector.count.toLocaleString()}</div>
            <div className={styles.statLabel}>Embeddings</div>
          </div>
        )}
      </div>

      {wisdom && (
        <>
          <div className={styles.wisdomCard} onClick={() => setShowModal(true)}>
            <div className={styles.wisdomGlow}></div>
            <div className={styles.wisdomInner}>
              <div className={styles.wisdomHeader}>
                <div className={styles.wisdomLabel}>
                  <span className={styles.wisdomOrb}></span>
                  <span>Oracle Wisdom</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); refreshWisdom(); }}
                  className={styles.refreshBtn}
                  title="New wisdom"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </button>
              </div>
              <div className={styles.wisdomQuote}>
                <span className={styles.quoteOpen}>"</span>
                <p className={styles.wisdomContent}>
                  {wisdom.content.length > 200
                    ? wisdom.content.slice(0, 200).trim() + '...'
                    : wisdom.content}
                </p>
                <span className={styles.quoteClose}>"</span>
              </div>
              <div className={styles.wisdomFooter}>
                <div className={styles.wisdomMeta}>
                  <span className={styles.wisdomType}>{wisdom.type}</span>
                  {wisdom.concepts && wisdom.concepts.length > 0 && (
                    <div className={styles.wisdomTags}>
                      {wisdom.concepts.slice(0, 4).map(c => (
                        <span key={c} className={styles.wisdomTag}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={styles.clickHint}>Click to read full</span>
              </div>
            </div>
          </div>

          {showModal && (
            <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <div className={styles.modalLabel}>
                    <span className={styles.wisdomOrb}></span>
                    <span>Oracle Wisdom</span>
                  </div>
                  <button onClick={() => setShowModal(false)} className={styles.closeBtn}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
                <div className={styles.modalContent}>
                  <Markdown remarkPlugins={[remarkGfm]}>{wisdom.content}</Markdown>
                </div>
                <div className={styles.modalFooter}>
                  <div className={styles.modalMeta}>
                    <span className={styles.wisdomType}>{wisdom.type}</span>
                    {wisdom.concepts && wisdom.concepts.length > 0 && (
                      <div className={styles.wisdomTags}>
                        {wisdom.concepts.map(c => (
                          <span key={c} className={styles.wisdomTag}>{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {wisdom.source_file && (
                    <div className={styles.sourceFile}>
                      <span className={styles.sourceLabel}>Source:</span>
                      <code>{stripProjectPrefix(wisdom.source_file, wisdom.project)}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className={styles.quickActions}>
        <h2 className={styles.sectionTitle}>Quick Actions</h2>
        <div className={styles.actionsGrid}>
          <a href="/search" className={styles.actionCard}>
            <span className={styles.actionIcon}>🔍</span>
            <span className={styles.actionTitle}>Search</span>
            <span className={styles.actionDesc}>Find patterns and learnings</span>
          </a>
          <a href="/graph" className={styles.actionCard}>
            <span className={styles.actionIcon}>🕸️</span>
            <span className={styles.actionTitle}>Graph</span>
            <span className={styles.actionDesc}>Visualize knowledge</span>
          </a>
          <a href="/playground" className={styles.actionCard}>
            <span className={styles.actionIcon}>🧪</span>
            <span className={styles.actionTitle}>Playground</span>
            <span className={styles.actionDesc}>Compare search modes</span>
          </a>
          <a href="/map" className={styles.actionCard}>
            <span className={styles.actionIcon}>🗺️</span>
            <span className={styles.actionTitle}>Map</span>
            <span className={styles.actionDesc}>Full knowledge map</span>
          </a>
        </div>
      </div>
    </div>
  );
}
