import { useState, useEffect } from 'react';
import { SidebarLayout, TOOLS_NAV } from '../components/SidebarLayout';
import { getDocDisplayInfo } from '../utils/docDisplay';
import styles from './Superseded.module.css';

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'learning', label: 'Learning' },
  { key: 'principle', label: 'Principle' },
  { key: 'retro', label: 'Retro' },
  { key: 'pattern', label: 'Pattern' },
];

interface SupersedeLog {
  id: number;
  old_path: string;
  old_id: string | null;
  old_title: string | null;
  old_type: string | null;
  new_path: string | null;
  new_id: string | null;
  new_title: string | null;
  reason: string | null;
  superseded_at: string;
  superseded_by: string | null;
  project: string | null;
}

interface SupersedeResponse {
  supersessions: SupersedeLog[];
  total: number;
  limit: number;
  offset: number;
}

export function Superseded() {
  const [logs, setLogs] = useState<SupersedeLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');
  const limit = 20;

  useEffect(() => {
    loadLogs();
  }, [page]);

  async function loadLogs() {
    setLoading(true);
    try {
      const res = await fetch(`/api/supersede?limit=${limit}&offset=${page * limit}`);
      const data: SupersedeResponse = await res.json();
      setLogs(data.supersessions || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load supersede logs:', e);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function extractTitle(path: string | null, title?: string | null) {
    if (title) return title;
    if (!path) return 'Unknown';
    const filename = path.split('/').pop() || path;
    return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
  }

  const filtered = typeFilter === 'all'
    ? logs
    : logs.filter(l => l.old_type === typeFilter);

  const totalPages = Math.ceil(total / limit);

  return (
    <SidebarLayout
      navItems={TOOLS_NAV}
      navTitle="Tools"
      filters={TYPE_FILTERS}
      filterTitle="Filter by Type"
      activeType={typeFilter}
      onTypeChange={setTypeFilter}
    >
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Superseded Documents</h1>
          <p className={styles.subtitle}>
            "Nothing is Deleted" — Old documents preserved but marked as outdated
          </p>
        </div>
        <div className={styles.stats}>
          {total} supersessions
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No superseded documents yet.</p>
          <p className={styles.hint}>
            Use <code>oracle_supersede(oldId, newId)</code> to mark outdated documents.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {filtered.map((log) => (
              <div key={log.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.badge}>{log.old_type || 'doc'}</span>
                  <span className={styles.date}>{formatDate(log.superseded_at)}</span>
                </div>

                <div className={styles.transition}>
                  <div className={styles.oldDoc}>
                    <span className={styles.label}>Old</span>
                    <span className={styles.docTitle}>{extractTitle(log.old_path, log.old_title)}</span>
                    <span className={styles.docPath}>{log.old_path}</span>
                  </div>

                  <div className={styles.arrow}>→</div>

                  <div className={styles.newDoc}>
                    <span className={styles.label}>New</span>
                    <span className={styles.docTitle}>{extractTitle(log.new_path, log.new_title)}</span>
                    <span className={styles.docPath}>{log.new_path || log.new_id || 'N/A'}</span>
                  </div>
                </div>

                {log.reason && (
                  <div className={styles.reason}>
                    <strong>Reason:</strong> {log.reason}
                  </div>
                )}

                <div className={styles.meta}>
                  <span>by {log.superseded_by || 'user'}</span>
                  {(() => {
                    const info = getDocDisplayInfo(log.old_path || '', log.project);
                    return (
                      <>
                        {info.projectVaultUrl ? (
                          <a
                            href={info.projectVaultUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.projectLink}
                          >
                            🔗 {info.projectDisplay}
                          </a>
                        ) : (
                          <span className={styles.universalBadge}>✦ universal</span>
                        )}
                        {log.old_path && info.vaultUrl && (
                          <a
                            href={info.vaultUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.vaultBadge}
                          >
                            🏛️ vault
                          </a>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className={styles.pageBtn}
              >
                ← Prev
              </button>
              <span className={styles.pageInfo}>
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={styles.pageBtn}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </SidebarLayout>
  );
}
