import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { memoryPath } from '../routePaths';

type LoadState = 'loading' | 'ready' | 'error';
type ReviewAction = 'approve' | 'reject';
type ReviewStatus = Record<string, string>;

export type ConsolidationDoc = {
  id: string;
  title: string;
  sourceFile?: string;
  type?: string;
  content?: string;
};

export type ConsolidationSuggestion = {
  id: string;
  original: ConsolidationDoc;
  suggested: ConsolidationDoc;
  confidence: number;
  reason: string;
};

type QueueClient = {
  list: () => Promise<ConsolidationSuggestion[]>;
  approve: (item: ConsolidationSuggestion) => Promise<void>;
  reject: (item: ConsolidationSuggestion) => Promise<void>;
};
type Props = { client?: QueueClient; initialSuggestions?: ConsolidationSuggestion[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numeric(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function docFrom(value: unknown, idFallback: string): ConsolidationDoc {
  const row = isRecord(value) ? value : {};
  const id = text(row.id ?? row.documentId ?? row.docId, idFallback);
  const title = text(row.title ?? row.sourceFile ?? row.source_file, id);
  return {
    id,
    title,
    sourceFile: text(row.sourceFile ?? row.source_file, ''),
    type: text(row.type, ''),
    content: text(row.content ?? row.preview ?? row.excerpt, ''),
  };
}

export function normalizeSuggestion(value: unknown): ConsolidationSuggestion | null {
  if (!isRecord(value)) return null;
  const oldId = text(value.oldId ?? value.old_id ?? value.originalId);
  const newId = text(value.newId ?? value.new_id ?? value.suggestedId);
  if (!oldId || !newId) return null;
  const confidence = numeric(value.confidence ?? value.score ?? value.cosine, 0);
  const id = text(value.id, `${oldId}->${newId}`);
  return {
    id,
    original: docFrom(value.original ?? value.old ?? value.oldDoc, oldId),
    suggested: docFrom(value.suggested ?? value.replacement ?? value.new ?? value.newDoc, newId),
    confidence,
    reason: text(value.reason, 'Memory consolidation suggested a supersede relationship.'),
  };
}

function suggestionsFromPayload(payload: unknown): ConsolidationSuggestion[] {
  const list = isRecord(payload)
    ? payload.suggestions ?? payload.items ?? payload.plans ?? []
    : payload;
  return Array.isArray(list) ? list.map(normalizeSuggestion).filter((item): item is ConsolidationSuggestion => Boolean(item)) : [];
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

function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function preview(doc: ConsolidationDoc): string { return doc.content || doc.sourceFile || doc.id; }

function ConfidencePill({ score }: { score: number }) {
  const tone = score >= 0.85 ? 'border-ok-border bg-ok-bg text-ok-text' : score >= 0.65 ? 'border-warn-border bg-warn-bg text-warn-text' : 'border-border bg-surface-muted text-text-muted';
  return <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${tone}`}>{percent(score)} confidence</span>;
}

function DocBlock({ label, doc }: { label: string; doc: ConsolidationDoc }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <h3 className="mt-2 break-words text-base font-semibold text-text">{doc.title}</h3>
      <p className="mt-2 line-clamp-3 text-sm text-text-muted">{preview(doc)}</p>
      <p className="mt-3 font-mono text-xs text-text-muted">{doc.id}</p>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  const title = error ? 'Consolidation queue unavailable' : 'No pending reviews';
  const detail = error || 'Memory consolidation has no supersede suggestions awaiting human review.';
  return (
    <section className="rounded-3xl border border-border bg-surface p-6 text-sm text-text-muted">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-2xl">{detail}</p>
    </section>
  );
}

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
          <article key={item.id} className="rounded-3xl border border-border bg-surface-muted p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <ConfidencePill score={item.confidence} />
                <p className="mt-3 max-w-3xl text-sm text-text-muted">{item.reason}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="focus-ring rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text disabled:opacity-50" disabled={Boolean(busy[item.id])} type="button" onClick={() => void review(item, 'reject')}>{busy[item.id] === 'reject' ? 'Rejecting…' : 'Reject'}</button>
                <button className="focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={Boolean(busy[item.id])} type="button" onClick={() => void review(item, 'approve')}>{busy[item.id] === 'approve' ? 'Approving…' : 'Approve'}</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
              <DocBlock label="Original doc" doc={item.original} />
              <div className="flex items-center justify-center text-sm font-semibold text-text-muted" aria-hidden="true">superseded by</div>
              <DocBlock label="Suggested supersede" doc={item.suggested} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><p className="text-sm text-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold text-text">{value}</p></div>;
}
