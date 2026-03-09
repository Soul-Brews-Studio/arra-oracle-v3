import { useState, useEffect } from 'react';
import { SidebarLayout, TOOLS_NAV } from '../components/SidebarLayout';
import styles from './Evolution.module.css';

const EVOLUTION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'learning', label: 'Learning' },
  { key: 'principle', label: 'Principle' },
  { key: 'retro', label: 'Retro' },
  { key: 'pattern', label: 'Pattern' },
];

interface Supersession {
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
  supersessions: Supersession[];
  total: number;
  limit: number;
  offset: number;
}

export function Evolution() {
  const [supersessions, setSupersessions] = useState<Supersession[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    loadSupersessions();
  }, []);

  async function loadSupersessions() {
    setLoading(true);
    try {
      const res = await fetch('/api/supersede');
      const data: SupersedeResponse = await res.json();
      setSupersessions(data.supersessions);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load supersessions:', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = typeFilter === 'all'
    ? supersessions
    : supersessions.filter(s => s.old_type === typeFilter);

  // Group by date
  const grouped = filtered.reduce((acc, s) => {
    const date = new Date(s.superseded_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(s);
    return acc;
  }, {} as Record<string, Supersession[]>);

  function getFileName(path: string | null): string {
    if (!path) return '(deleted)';
    return path.split('/').pop() || path;
  }

  function getTypeEmoji(type: string | null): string {
    switch (type) {
      case 'learning': return '📚';
      case 'principle': return '💎';
      case 'retro': return '📝';
      case 'pattern': return '🔮';
      default: return '📄';
    }
  }

  return (
    <SidebarLayout
      navItems={TOOLS_NAV}
      navTitle="Tools"
      filters={EVOLUTION_FILTERS}
      filterTitle="Filter by Type"
      activeType={typeFilter}
      onTypeChange={setTypeFilter}
    >
      <h1 className={styles.title}>Knowledge Evolution</h1>
      <p className={styles.subtitle}>
        Track how knowledge evolves — what was superseded and why
        <span className={styles.philosophy}>"Nothing is Deleted"</span>
      </p>

      {loading ? (
        <div className={styles.loading}>Loading supersessions...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No supersessions recorded yet.</p>
          <p className={styles.hint}>
            Use <code>oracle_supersede()</code> to track document evolution.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.stats}>
            <span>{total} supersession{total !== 1 ? 's' : ''} recorded</span>
          </div>

          <div className={styles.timeline}>
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date} className={styles.dateGroup}>
                <h2 className={styles.date}>{date}</h2>
                <div className={styles.items}>
                  {items.map(s => (
                    <div key={s.id} className={styles.item}>
                      <div className={styles.arrow}>
                        <span className={styles.old}>
                          {getTypeEmoji(s.old_type)} {getFileName(s.old_path)}
                        </span>
                        <span className={styles.connector}>→</span>
                        <span className={styles.new}>
                          {s.new_path ? getFileName(s.new_path) : '(archived)'}
                        </span>
                      </div>
                      {s.reason && (
                        <div className={styles.reason}>
                          "{s.reason}"
                        </div>
                      )}
                      <div className={styles.meta}>
                        <span className={styles.by}>
                          by {s.superseded_by || 'unknown'}
                        </span>
                        <span className={styles.time}>
                          {new Date(s.superseded_at).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SidebarLayout>
  );
}
