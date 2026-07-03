import { useEffect, useMemo, useState } from 'react';
import { fetchDocumentFeed } from '../api';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import type { SearchResponse, SearchResult } from '../types';

type PageState = 'loading' | 'ready' | 'error';
type FeedLoader = (limit?: number, offset?: number) => Promise<SearchResponse>;

const LIMIT = 50;

export function feedStatus(state: PageState, total: number, count: number): string {
  if (state === 'loading') return 'Loading DB-backed document feed…';
  if (state === 'error') return 'Document feed failed.';
  return total ? `Showing ${count} of ${total} DB/FTS documents.` : 'No DB/FTS documents found.';
}

function preview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 179).trimEnd()}…` : compact;
}

function typeCounts(items: SearchResult[]): string {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.type || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(' · ') || 'No loaded rows';
}

function FeedRows({ items }: { items: SearchResult[] }) {
  if (!items.length) return <EmptyState text="No documents returned from /api/list." />;
  return (
    <div className="grid gap-3" aria-label="DB-backed document feed">
      {items.map((item) => (
        <article key={item.id} className="min-w-0 rounded-2xl border border-border bg-surface-muted p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold text-text">{item.source_file || item.id}</h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">{preview(item.content)}</p>
            </div>
            <span className="rounded-full border border-accent-border px-2 py-1 text-xs font-semibold text-accent">
              {item.type || 'unknown'}
            </span>
          </div>
          <p className="mt-3 font-mono text-xs text-text-muted">{item.project || 'unscoped'} · {item.source || 'fts/db'}</p>
        </article>
      ))}
    </div>
  );
}

export function FeedPage({ load = fetchDocumentFeed }: { load?: FeedLoader }) {
  const [items, setItems] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');

  async function refresh() {
    setState('loading');
    setError('');
    try {
      const data = await load(LIMIT, 0);
      setItems(data.results);
      setTotal(data.total);
      setState('ready');
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => { void refresh(); }, [load]);
  const status = useMemo(() => feedStatus(state, total, items.length), [items.length, state, total]);

  return (
    <section className="w-full min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="feed-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Feed</p>
          <h1 id="feed-title" className="mt-2 text-3xl font-semibold text-text">Document feed</h1>
          <p className="mt-2 text-sm text-text-muted">Reads /api/list from SQLite/FTS, not vector document collections.</p>
        </div>
        <button className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="mb-2 text-sm text-text-muted">{status}</p>
      <p className="mb-5 text-xs text-text-muted">{typeCounts(items)}</p>
      {state === 'loading' ? <LoadingPanel title="Loading feed…" detail="Fetching /api/list?group=false from the DB-backed API." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load document feed." message={error} /> : null}
      {state === 'ready' ? <FeedRows items={items} /> : null}
    </section>
  );
}
