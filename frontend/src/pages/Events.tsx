import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './Events.module.css';

interface FeedEvent {
  timestamp: string;
  oracle: string;
  host: string;
  event: string;
  project: string;
  session_id: string;
  message: string;
}

interface FeedResponse {
  events: FeedEvent[];
  total: number;
  active_oracles?: string[];
}

const EVENT_TYPES = ['all', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'TaskCompleted', 'SessionStart', 'SessionEnd', 'Stop', 'Notification'] as const;
type EventType = typeof EVENT_TYPES[number];

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

function getEventIcon(eventType: string): string {
  switch (eventType?.toLowerCase()) {
    case 'pretooluse': return '⚡';
    case 'posttooluse': return '✅';
    case 'posttoolusefailure': return '❌';
    case 'userpromptsubmit': return '💬';
    case 'subagentstart': return '🤖';
    case 'subagentstop': return '✅';
    case 'taskcompleted': return '🎉';
    case 'sessionstart': return '🟢';
    case 'sessionend': return '⏹️';
    case 'stop': return '⏹️';
    case 'notification': return '🔔';
    default: return '✨';
  }
}

export function Events() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [activeOracles, setActiveOracles] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // URL-persisted filters
  const eventType = (searchParams.get('type') as EventType) || 'all';
  const oracleFilter = searchParams.get('oracle') || '';

  function setEventType(type: EventType) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (type === 'all') {
        params.delete('type');
      } else {
        params.set('type', type);
      }
      return params;
    });
  }

  function setOracleFilter(oracle: string) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (oracle) {
        params.set('oracle', oracle);
      } else {
        params.delete('oracle');
      }
      return params;
    });
  }

  useEffect(() => {
    loadEvents();
  }, [eventType, oracleFilter]);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (eventType !== 'all') {
        params.set('event', eventType);
      }
      if (oracleFilter) {
        params.set('oracle', oracleFilter);
      }

      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) throw new Error('Failed to load events');

      const data: FeedResponse = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setActiveOracles(data.active_oracles || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // Get unique oracles from events for filter dropdown
  const uniqueOracles = [...new Set(events.map(e => e.oracle).filter(Boolean))];

  if (loading && events.length === 0) {
    return <div className={styles.loading}>Loading events...</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>🔮 Events</h1>
        <p className={styles.subtitle}>
          Real-time Oracle activity feed
          {activeOracles.length > 0 && (
            <span className={styles.activeCount}>
              · {activeOracles.length} active
            </span>
          )}
        </p>
      </header>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Event Type</label>
          <div className={styles.filterButtons}>
            {EVENT_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setEventType(type)}
                className={`${styles.filterBtn} ${eventType === type ? styles.active : ''}`}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {uniqueOracles.length > 0 && (
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Oracle</label>
            <select
              value={oracleFilter}
              onChange={(e) => setOracleFilter(e.target.value)}
              className={styles.select}
            >
              <option value="">All Oracles</option>
              {uniqueOracles.map(oracle => (
                <option key={oracle} value={oracle}>{oracle}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <span className={styles.statItem}>
          <span className={styles.statValue}>{total}</span> events
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={loadEvents} className={styles.retryBtn}>Retry</button>
        </div>
      )}

      {/* Events List */}
      <div className={styles.eventsList}>
        {events.length === 0 && !loading ? (
          <div className={styles.empty}>
            <p>No events found</p>
            <p className={styles.emptyHint}>
              Events are logged to ~/.arra-oracle-v3/feed.log
            </p>
          </div>
        ) : (
          events.map((event, i) => (
            <div key={`${event.timestamp}-${i}`} className={styles.eventCard}>
              <div className={styles.eventIcon}>
                {getEventIcon(event.event)}
              </div>
              <div className={styles.eventContent}>
                <div className={styles.eventHeader}>
                  <span className={styles.oracleName}>{event.oracle || 'Unknown'}</span>
                  <span className={styles.eventType}>{event.event}</span>
                  <span className={styles.eventTime}>{formatTimeAgo(event.timestamp)}</span>
                </div>
                {event.message && (
                  <p className={styles.eventMessage}>{event.message}</p>
                )}
                <div className={styles.eventMeta}>
                  {event.project && (
                    <span className={styles.metaItem}>📁 {event.project}</span>
                  )}
                  {event.host && (
                    <span className={styles.metaItem}>💻 {event.host}</span>
                  )}
                  {event.session_id && (
                    <span className={styles.metaItem}>🔗 {event.session_id.slice(0, 8)}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Load More */}
      {events.length > 0 && events.length < total && (
        <button onClick={loadEvents} className={styles.loadMore}>
          Load More ({total - events.length} remaining)
        </button>
      )}
    </div>
  );
}
