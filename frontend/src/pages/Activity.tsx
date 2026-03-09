import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getDashboardSummary, getDashboardActivity, getDashboardGrowth } from '../api/oracle';
import type { DashboardSummary, DashboardActivity, DashboardGrowth } from '../api/oracle';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import styles from './Activity.module.css';

const PERIODS = ['week', 'month', 'quarter'] as const;
type Period = typeof PERIODS[number];

const TABS = ['gaps', 'searches', 'consultations', 'learnings'] as const;
type Tab = typeof TABS[number];

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function Activity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activity, setActivity] = useState<DashboardActivity | null>(null);
  const [growth, setGrowth] = useState<DashboardGrowth | null>(null);
  const [loading, setLoading] = useState(true);

  // URL-persisted state
  const period = (searchParams.get('period') as Period) || 'week';
  const activeTab = (searchParams.get('tab') as Tab) || 'gaps';

  // Knowledge gaps: searches and consultations with 0 results
  const gaps = [
    ...(activity?.searches.filter(s => s.results_count === 0).map(s => ({
      type: 'search' as const,
      query: s.query,
      created_at: s.created_at
    })) || []),
    ...(activity?.consultations.filter(c => c.principles_found === 0 && c.patterns_found === 0).map(c => ({
      type: 'consult' as const,
      query: c.decision,
      created_at: c.created_at
    })) || [])
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function setPeriod(newPeriod: Period) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set('period', newPeriod);
      return params;
    });
  }

  function setActiveTab(newTab: Tab) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set('tab', newTab);
      return params;
    });
  }

  useEffect(() => {
    loadData();
  }, [period]);

  async function loadData() {
    setLoading(true);
    try {
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 90;
      const [summaryData, activityData, growthData] = await Promise.all([
        getDashboardSummary(),
        getDashboardActivity(days),
        getDashboardGrowth(period)
      ]);
      setSummary(summaryData);
      setActivity(activityData);
      setGrowth(growthData);
    } finally {
      setLoading(false);
    }
  }

  // Calculate averages
  const avgSearchTime = activity?.searches.length
    ? Math.round(activity.searches.reduce((sum, s) => sum + s.search_time_ms, 0) / activity.searches.length)
    : 0;

  const avgMatches = activity?.consultations.length
    ? (activity.consultations.reduce((sum, c) => sum + c.principles_found + c.patterns_found, 0) / activity.consultations.length).toFixed(1)
    : '0';

  if (loading && !summary) {
    return <div className={styles.loading}>Loading activity data...</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Activity</h1>
        <p className={styles.subtitle}>Search logs, consultations, and learning history</p>
      </header>

      {/* Period Selector */}
      <div className={styles.periodSelector}>
        {PERIODS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`${styles.periodBtn} ${period === p ? styles.active : ''}`}
          >
            {p === 'week' ? '7 days' : p === 'month' ? '30 days' : '90 days'}
          </button>
        ))}
      </div>

      {/* Summary Cards - clickable to switch tabs */}
      <div className={styles.summaryGrid}>
        <button
          type="button"
          onClick={() => setActiveTab('gaps')}
          className={`${styles.statCard} ${styles.clickableCard} ${gaps.length > 0 ? styles.gapCard : ''} ${activeTab === 'gaps' ? styles.activeCard : ''}`}
        >
          <div className={styles.statIcon}>⚠️</div>
          <div className={styles.statValue}>{gaps.length}</div>
          <div className={styles.statLabel}>Knowledge Gaps</div>
          <div className={styles.statMeta}>0 result queries</div>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('searches')}
          className={`${styles.statCard} ${styles.clickableCard} ${activeTab === 'searches' ? styles.activeCard : ''}`}
        >
          <div className={styles.statIcon}>🔍</div>
          <div className={styles.statValue}>{summary?.activity.searches_7d ?? 0}</div>
          <div className={styles.statLabel}>Searches</div>
          <div className={styles.statMeta}>avg {avgSearchTime}ms</div>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('consultations')}
          className={`${styles.statCard} ${styles.clickableCard} ${activeTab === 'consultations' ? styles.activeCard : ''}`}
        >
          <div className={styles.statIcon}>💬</div>
          <div className={styles.statValue}>{summary?.activity.consultations_7d ?? 0}</div>
          <div className={styles.statLabel}>Consultations</div>
          <div className={styles.statMeta}>avg {avgMatches} matches</div>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('learnings')}
          className={`${styles.statCard} ${styles.clickableCard} ${activeTab === 'learnings' ? styles.activeCard : ''}`}
        >
          <div className={styles.statIcon}>📚</div>
          <div className={styles.statValue}>{summary?.activity.learnings_7d ?? 0}</div>
          <div className={styles.statLabel}>Learnings</div>
          <div className={styles.statMeta}>this period</div>
        </button>
      </div>

      {/* Growth Chart */}
      {growth && growth.data.length > 0 && (
        <div className={styles.chartContainer}>
          <h2 className={styles.sectionTitle}>Daily Activity</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={growth.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                stroke="#666"
                fontSize={12}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', { weekday: 'short' });
                }}
              />
              <YAxis stroke="#666" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #2a2a3a',
                  borderRadius: '8px',
                  color: '#e0e0e0'
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="searches" stroke="#a78bfa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="consultations" stroke="#4ade80" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="documents" stroke="#fbbf24" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Activity Timeline */}
      <div className={styles.timeline}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Activity</h2>
          <button
            type="button"
            onClick={() => loadData()}
            className={`${styles.refreshBtn} ${loading ? styles.spinning : ''}`}
            disabled={loading}
            title="Refresh data"
          >
            ↻
          </button>
        </div>

        <div className={styles.tabs}>
          {TABS.map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`${styles.tabBtn} ${activeTab === tab ? styles.active : ''} ${tab === 'gaps' && gaps.length > 0 ? styles.gapTab : ''}`}
            >
              {tab === 'gaps' ? 'Knowledge Gaps' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              <span className={`${styles.tabCount} ${tab === 'gaps' && gaps.length > 0 ? styles.gapCount : ''}`}>
                {tab === 'gaps' ? gaps.length :
                 tab === 'searches' ? activity?.searches.length ?? 0 :
                 tab === 'consultations' ? activity?.consultations.length ?? 0 :
                 activity?.learnings.length ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.activityList}>
          {/* Knowledge Gaps Tab */}
          {activeTab === 'gaps' && gaps.map((g, i) => (
            <div key={i} className={`${styles.activityItem} ${styles.gapItem}`}>
              <div className={styles.activityIcon}>{g.type === 'search' ? '🔍' : '💬'}</div>
              <div className={styles.activityContent}>
                <div className={styles.activityTitle}>"{g.query}"</div>
                <div className={styles.activityMeta}>
                  No results found &middot; {g.type === 'search' ? 'Search' : 'Consult'}
                </div>
              </div>
              <div className={styles.gapActions}>
                <Link
                  to={`/search?q=${encodeURIComponent(g.query)}`}
                  className={styles.actionBtn}
                  title="Search again"
                >
                  🔄
                </Link>
                <button
                  type="button"
                  className={styles.learnBtn}
                  onClick={() => {
                    // Trigger QuickLearn with pre-filled query
                    const event = new CustomEvent('quicklearn:open', { detail: { query: g.query } });
                    window.dispatchEvent(event);
                  }}
                  title="Add knowledge about this topic"
                >
                  ➕ Learn
                </button>
              </div>
            </div>
          ))}
          {activeTab === 'gaps' && gaps.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>✨</div>
              <div>No knowledge gaps! All searches found results.</div>
            </div>
          )}

          {/* Searches Tab */}
          {activeTab === 'searches' && activity?.searches.map((s, i) => (
            <Link
              key={i}
              to={`/search?q=${encodeURIComponent(s.query)}`}
              className={`${styles.activityItem} ${styles.clickable} ${s.results_count === 0 ? styles.gapItem : ''}`}
            >
              <div className={styles.activityIcon}>🔍</div>
              <div className={styles.activityContent}>
                <div className={styles.activityTitle}>"{s.query}"</div>
                <div className={styles.activityMeta}>
                  {s.results_count === 0 ? (
                    <span className={styles.noResults}>No results</span>
                  ) : (
                    <>{s.results_count} results</>
                  )} &middot; {s.search_time_ms}ms &middot; {s.type}
                </div>
              </div>
              <div className={styles.activityTime}>{formatTimeAgo(s.created_at)}</div>
            </Link>
          ))}

          {/* Consultations Tab */}
          {activeTab === 'consultations' && activity?.consultations.map((c, i) => {
            const hasResults = c.principles_found > 0 || c.patterns_found > 0;
            return (
              <div key={i} className={`${styles.activityItem} ${!hasResults ? styles.gapItem : ''}`}>
                <div className={styles.activityIcon}>💬</div>
                <div className={styles.activityContent}>
                  <div className={styles.activityTitle}>"{c.decision}"</div>
                  <div className={styles.activityMeta}>
                    {!hasResults ? (
                      <span className={styles.noResults}>No matches</span>
                    ) : (
                      <>{c.principles_found} principles &middot; {c.patterns_found} patterns</>
                    )}
                  </div>
                </div>
                <div className={styles.activityTime}>{formatTimeAgo(c.created_at)}</div>
              </div>
            );
          })}

          {/* Learnings Tab */}
          {activeTab === 'learnings' && activity?.learnings.map((l, i) => (
            <div key={i} className={styles.activityItem}>
              <div className={styles.activityIcon}>📚</div>
              <div className={styles.activityContent}>
                <div className={styles.activityTitle}>{l.pattern_preview}</div>
                <div className={styles.activityMeta}>
                  {l.concepts.join(', ') || 'No concepts'} &middot; {l.source}
                </div>
              </div>
              <div className={styles.activityTime}>{formatTimeAgo(l.created_at)}</div>
            </div>
          ))}

          {/* Empty States */}
          {activeTab === 'searches' && !activity?.searches.length && (
            <div className={styles.empty}>No searches in this period</div>
          )}
          {activeTab === 'consultations' && !activity?.consultations.length && (
            <div className={styles.empty}>No consultations in this period</div>
          )}
          {activeTab === 'learnings' && !activity?.learnings.length && (
            <div className={styles.empty}>No learnings added in this period</div>
          )}
        </div>
      </div>
    </div>
  );
}
