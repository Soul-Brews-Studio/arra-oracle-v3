import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { memoryPath } from '../routePaths';
import {
  EmptyState,
  SuggestionCard,
  Summary,
  percent,
  suggestionsFromPayload,
  normalizeSuggestion,
  type ConsolidationSuggestion,
} from './memoryConsolidationView';

export { normalizeSuggestion, type ConsolidationSuggestion };

type LoadState = 'loading' | 'ready' | 'error';
type ReviewAction = 'approve' | 'reject';
type ReviewStatus = Record<string, string>;

type QueueClient = {
  list: () => Promise<ConsolidationSuggestion[]>;
  approve: (item: ConsolidationSuggestion) => Promise<void>;
  reject: (item: ConsolidationSuggestion) => Promise<void>;
};
type Props = { client?: QueueClient; initialSuggestions?: ConsolidationSuggestion[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) as unknown : {};
  if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === 'string' ? payload.error : `${path} returned ${response.status}`);
  return payload as T;
}

async function postReview(path: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const consolidationQueueClient: QueueClient = {
  async list() {
    return suggestionsFromPayload(await json('/api/memory/consolidation/suggestions?limit=50'));
  },
  async approve(item) {
    const body = { oldId: item.original.id, newId: item.suggested.id, reason: item.reason };
    const review = await postReview(`/api/memory/consolidation/suggestions/${encodeURIComponent(item.id)}/approve`, body);
    if (review.ok) return;
    if (review.status !== 404) throw new Error(`Approve failed (${review.status})`);
    await json('/api/supersede/document', { method: 'POST', body: JSON.stringify(body) });
  },
  async reject(item) {
    const review = await postReview(`/api/memory/consolidation/suggestions/${encodeURIComponent(item.id)}/reject`, { reason: 'rejected by reviewer' });
    if (!review.ok && review.status !== 404) throw new Error(`Reject failed (${review.status})`);
  },
};

export function MemoryConsolidationPage({ client = consolidationQueueClient, initialSuggestions }: Props) {
  const [state, setState] = useState<LoadState>(initialSuggestions ? 'ready' : 'loading');
  const [items, setItems] = useState<ConsolidationSuggestion[]>(initialSuggestions ?? []);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<ReviewStatus>({});

  useEffect(() => {
    if (initialSuggestions) return;
    let active = true;
    setState('loading');
    client.list().then((next) => {
      if (!active) return;
      setItems(next);
      setState('ready');
    }).catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    });
    return () => { active = false; };
  }, [client, initialSuggestions]);

  const summary = useMemo(() => {
    const high = items.filter((item) => item.confidence >= 0.85).length;
    const avg = items.length ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0;
    return { high, avg };
  }, [items]);

  async function review(item: ConsolidationSuggestion, action: ReviewAction) {
    setBusy((current) => ({ ...current, [item.id]: action }));
    setError('');
    try {
      if (action === 'approve') await client.approve(item);
      else await client.reject(item);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`${action === 'approve' ? 'Approved' : 'Rejected'} ${item.original.id} → ${item.suggested.id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(({ [item.id]: _done, ...rest }) => rest);
    }
  }

  return (
    <div className="grid w-full min-w-0 gap-5">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] p-5 sm:p-6" aria-labelledby="memory-consolidation-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-accent2">Memory governance</p>
            <h1 id="memory-consolidation-title" className="mt-2 text-2xl font-semibold text-text">Consolidation review queue</h1>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">Review pending supersede suggestions before they change memory ranking. Approve only when the suggested document is the better current source.</p>
          </div>
          <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text hover:border-accent-border" to={memoryPath()}>Memory dashboard</Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Queue summary">
        <Summary label="Pending" value={String(items.length)} />
        <Summary label="High confidence" value={String(summary.high)} />
        <Summary label="Average confidence" value={percent(summary.avg)} />
      </section>

      {message ? <p className="rounded-2xl border border-ok-border bg-ok-bg p-3 text-sm text-ok-text">{message}</p> : null}
      {error && state !== 'error' ? <p role="alert" className="rounded-2xl border border-err-border bg-err-bg p-3 text-sm text-err-text">{error}</p> : null}
      {state === 'loading' ? <EmptyState error="Loading pending memory consolidation suggestions…" /> : null}
      {state === 'error' ? <EmptyState error={error} /> : null}
      {state === 'ready' && !items.length ? <EmptyState /> : null}

      <section className="grid gap-4" aria-label="Pending supersede suggestions">
        {items.map((item) => (
          <SuggestionCard key={item.id} item={item} actions={(
            <>
              <button className="focus-ring rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text disabled:opacity-50" disabled={Boolean(busy[item.id])} type="button" onClick={() => void review(item, 'reject')}>{busy[item.id] === 'reject' ? 'Rejecting…' : 'Reject'}</button>
              <button className="focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={Boolean(busy[item.id])} type="button" onClick={() => void review(item, 'approve')}>{busy[item.id] === 'approve' ? 'Approving…' : 'Approve'}</button>
            </>
          )} />
        ))}
      </section>
    </div>
  );
}
