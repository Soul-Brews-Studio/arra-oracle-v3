import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { search } from '../api/oracle';
import type { Document } from '../api/oracle';
import styles from './Playground.module.css';

interface ColumnResult {
  results: Document[];
  total: number;
  time: number;
  avgScore: number;
}

// Animated count-up hook
function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = ref.current;
    const diff = target - start;
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setValue(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);

  return value;
}

export function Playground() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [ftsCol, setFtsCol] = useState<ColumnResult | null>(null);
  const [vectorCol, setVectorCol] = useState<ColumnResult | null>(null);
  const [hybridCol, setHybridCol] = useState<ColumnResult | null>(null);
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [resultsVisible, setResultsVisible] = useState(false);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    setResultsVisible(false);

    const modes = ['fts', 'vector', 'hybrid'] as const;
    const results = await Promise.all(
      modes.map(async (mode) => {
        const start = performance.now();
        try {
          const data = await search(q, 'all', 20, mode);
          const time = Math.round(performance.now() - start);
          const scores = data.results.map(r => r.score || 0);
          const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
          return { results: data.results, total: data.total, time, avgScore };
        } catch {
          return { results: [], total: 0, time: Math.round(performance.now() - start), avgScore: 0 };
        }
      })
    );

    setFtsCol(results[0]);
    setVectorCol(results[1]);
    setHybridCol(results[2]);
    setLoading(false);
    // Trigger stagger animation after a tick
    requestAnimationFrame(() => setResultsVisible(true));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSearch(query);
  }

  // Shared/unique ID computation
  const ftsIds = new Set(ftsCol?.results.map(r => r.id) || []);
  const vectorIds = new Set(vectorCol?.results.map(r => r.id) || []);
  const hybridIds = new Set(hybridCol?.results.map(r => r.id) || []);

  const allIds = new Set([...ftsIds, ...vectorIds, ...hybridIds]);
  const sharedIds = new Set([...allIds].filter(id => ftsIds.has(id) && vectorIds.has(id)));
  const ftsOnly = new Set([...ftsIds].filter(id => !vectorIds.has(id)));
  const vectorOnly = new Set([...vectorIds].filter(id => !ftsIds.has(id)));

  // Max time for timing bars
  const maxTime = Math.max(ftsCol?.time || 0, vectorCol?.time || 0, hybridCol?.time || 0, 1);

  return (
    <div className={styles.container}>
      {/* Pre-search landing */}
      {!searched && !loading && (
        <div className={styles.landing}>
          <h1 className={styles.landingTitle}>Vector Playground</h1>
          <p className={styles.landingSubtitle}>Compare search modes side-by-side</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a query to compare FTS, Vector, and Hybrid..."
              className={styles.input}
              autoFocus
            />
            <button type="submit" className={styles.button} disabled={loading}>
              Compare
            </button>
          </form>

          <div className={styles.modeCards}>
            <div className={`${styles.modeCard} ${styles.modeCardFts}`}>
              <div className={styles.modeIcon}>FTS5</div>
              <p className={styles.modeDesc}>Full-text search using SQLite's FTS5 engine. Fast keyword matching with ranking.</p>
            </div>
            <div className={`${styles.modeCard} ${styles.modeCardVector}`}>
              <div className={styles.modeIcon}>Vector</div>
              <p className={styles.modeDesc}>Semantic search using ChromaDB embeddings. Finds conceptually similar results.</p>
            </div>
            <div className={`${styles.modeCard} ${styles.modeCardHybrid}`}>
              <div className={styles.modeIcon}>Hybrid</div>
              <p className={styles.modeDesc}>Best of both. Combines results and boosts docs found by both engines.</p>
            </div>
          </div>
        </div>
      )}

      {/* Post-search view */}
      {(searched || loading) && (
        <div className={styles.resultsView}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search query..."
              className={styles.input}
              autoFocus
            />
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Searching...' : 'Compare'}
            </button>
          </form>

          {loading && (
            <div className={styles.skeletonContainer}>
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.skeletonColumn}>
                  <div className={styles.skeletonHeader} />
                  {[0, 1, 2, 3, 4].map(j => (
                    <div key={j} className={styles.skeletonCard} style={{ animationDelay: `${j * 80}ms` }} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {!loading && ftsCol && (
            <>
              <SummaryBar
                fts={ftsCol}
                vector={vectorCol}
                hybrid={hybridCol}
                sharedCount={sharedIds.size}
                maxTime={maxTime}
              />

              <div className={styles.columns}>
                <Column
                  title="FTS5"
                  color="#60a5fa"
                  data={ftsCol}
                  uniqueIds={ftsOnly}
                  sharedIds={sharedIds}
                  hoveredDocId={hoveredDocId}
                  onHover={setHoveredDocId}
                  visible={resultsVisible}
                />
                <Column
                  title="Vector"
                  color="#a78bfa"
                  data={vectorCol}
                  uniqueIds={vectorOnly}
                  sharedIds={sharedIds}
                  hoveredDocId={hoveredDocId}
                  onHover={setHoveredDocId}
                  visible={resultsVisible}
                />
                <Column
                  title="Hybrid"
                  color="#4ade80"
                  data={hybridCol}
                  uniqueIds={new Set()}
                  sharedIds={sharedIds}
                  hoveredDocId={hoveredDocId}
                  onHover={setHoveredDocId}
                  visible={resultsVisible}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Summary bar with animated count-up and timing bars
function SummaryBar({
  fts, vector, hybrid, sharedCount, maxTime
}: {
  fts: ColumnResult | null;
  vector: ColumnResult | null;
  hybrid: ColumnResult | null;
  sharedCount: number;
  maxTime: number;
}) {
  const ftsCount = useCountUp(fts?.total || 0);
  const vecCount = useCountUp(vector?.total || 0);
  const hybCount = useCountUp(hybrid?.total || 0);
  const sharedAnim = useCountUp(sharedCount);

  return (
    <div className={styles.summaryBar}>
      <div className={styles.summaryStats}>
        <div className={styles.summaryStat}>
          <span className={styles.summaryNum} style={{ color: '#60a5fa' }}>{ftsCount}</span>
          <span className={styles.summaryLabel}>FTS</span>
          <div className={styles.timingBar}>
            <div
              className={styles.timingFill}
              style={{
                width: `${((fts?.time || 0) / maxTime) * 100}%`,
                background: '#60a5fa',
              }}
            />
          </div>
          <span className={styles.timingMs}>{fts?.time || 0}ms</span>
        </div>

        <div className={styles.summaryStat}>
          <span className={styles.summaryNum} style={{ color: '#a78bfa' }}>{vecCount}</span>
          <span className={styles.summaryLabel}>Vector</span>
          <div className={styles.timingBar}>
            <div
              className={styles.timingFill}
              style={{
                width: `${((vector?.time || 0) / maxTime) * 100}%`,
                background: '#a78bfa',
              }}
            />
          </div>
          <span className={styles.timingMs}>{vector?.time || 0}ms</span>
        </div>

        <div className={styles.summaryStat}>
          <span className={styles.summaryNum} style={{ color: '#4ade80' }}>{hybCount}</span>
          <span className={styles.summaryLabel}>Hybrid</span>
          <div className={styles.timingBar}>
            <div
              className={styles.timingFill}
              style={{
                width: `${((hybrid?.time || 0) / maxTime) * 100}%`,
                background: '#4ade80',
              }}
            />
          </div>
          <span className={styles.timingMs}>{hybrid?.time || 0}ms</span>
        </div>
      </div>

      {/* Venn overlap indicator */}
      <div className={styles.vennContainer}>
        <div className={styles.vennCircles}>
          <div
            className={styles.vennCircle}
            style={{
              background: 'rgba(96, 165, 250, 0.15)',
              border: '1.5px solid rgba(96, 165, 250, 0.4)',
              width: `${Math.max(28, Math.min(56, (fts?.results.length || 0) * 3))}px`,
              height: `${Math.max(28, Math.min(56, (fts?.results.length || 0) * 3))}px`,
            }}
          />
          <div
            className={styles.vennCircle}
            style={{
              background: 'rgba(167, 139, 250, 0.15)',
              border: '1.5px solid rgba(167, 139, 250, 0.4)',
              width: `${Math.max(28, Math.min(56, (vector?.results.length || 0) * 3))}px`,
              height: `${Math.max(28, Math.min(56, (vector?.results.length || 0) * 3))}px`,
              marginLeft: '-12px',
            }}
          />
        </div>
        <span className={styles.vennLabel}>{sharedAnim} shared</span>
      </div>
    </div>
  );
}

// Column component with stagger animation and cross-highlight
function Column({
  title, color, data, uniqueIds, sharedIds, hoveredDocId, onHover, visible
}: {
  title: string;
  color: string;
  data: ColumnResult | null;
  uniqueIds: Set<string>;
  sharedIds: Set<string>;
  hoveredDocId: string | null;
  onHover: (id: string | null) => void;
  visible: boolean;
}) {
  if (!data) return null;

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <div className={styles.columnGlow} style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
        <span className={styles.columnTitle} style={{ color }}>{title}</span>
        <div className={styles.columnStats}>
          <span className={styles.columnStatBig}>{data.results.length}</span>
          <span className={styles.columnStatLabel}>results</span>
          <span className={styles.columnStatDivider} />
          <span className={styles.columnStatBig}>{data.time}ms</span>
          <span className={styles.columnStatLabel}>time</span>
          <span className={styles.columnStatDivider} />
          <span className={styles.columnStatBig}>{Math.round(data.avgScore * 100)}%</span>
          <span className={styles.columnStatLabel}>avg</span>
        </div>
      </div>
      <div className={styles.columnResults}>
        {data.results.map((doc, index) => {
          const scorePercent = Math.round((doc.score || 0) * 100);
          const isShared = sharedIds.has(doc.id);
          const isUnique = uniqueIds.has(doc.id);
          const isCrossHighlighted = hoveredDocId === doc.id;

          return (
            <Link
              key={doc.id}
              to={`/doc/${encodeURIComponent(doc.id)}`}
              state={{ doc }}
              className={`${styles.resultCard} ${isShared ? styles.shared : ''} ${isUnique ? styles.unique : ''} ${isCrossHighlighted ? styles.crossHighlight : ''} ${visible ? styles.cardVisible : ''}`}
              style={{ transitionDelay: visible ? `${index * 30}ms` : '0ms' }}
              onMouseEnter={() => isShared ? onHover(doc.id) : undefined}
              onMouseLeave={() => onHover(null)}
            >
              <div className={styles.resultHeader}>
                <div className={styles.resultScore}>
                  <div className={styles.resultScoreBar}>
                    <div
                      className={styles.resultScoreFill}
                      style={{
                        width: visible ? `${scorePercent}%` : '0%',
                        background: color,
                        transitionDelay: visible ? `${index * 30 + 200}ms` : '0ms',
                      }}
                    />
                  </div>
                  <span className={styles.resultScoreLabel}>{scorePercent}%</span>
                </div>
                {isShared && <span className={styles.sharedBadge}>shared</span>}
                {isUnique && <span className={styles.uniqueBadge}>unique</span>}
              </div>
              <div className={styles.resultType}>{doc.type}</div>
              <div className={styles.resultTitle}>
                {(doc.content || '').replace(/^---[\s\S]*?---\s*/, '').replace(/^#+\s*/gm, '').split('\n')[0]?.slice(0, 60) || doc.id}
              </div>
            </Link>
          );
        })}
        {data.results.length === 0 && (
          <div className={styles.emptyCol}>No results</div>
        )}
      </div>
    </div>
  );
}
