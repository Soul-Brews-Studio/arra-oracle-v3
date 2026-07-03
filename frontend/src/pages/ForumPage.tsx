import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import {
  FORUM_THREAD_STATUSES,
  FORUM_THREADS_ENDPOINT,
  fetchForumThreads,
  type ForumThreadStatus,
  type ForumThreadSummary,
  type ForumThreadsResponse,
} from '../api/forum';

type PageState = 'loading' | 'ready' | 'error';
type ForumStatusFilter = ForumThreadStatus | 'all';
type ForumClient = { threads: (status?: ForumThreadStatus) => Promise<ForumThreadsResponse> };

const EMPTY_THREADS: ForumThreadSummary[] = [];
const statusOptions: ForumStatusFilter[] = ['all', ...FORUM_THREAD_STATUSES];
const defaultClient: ForumClient = { threads: (status) => fetchForumThreads({ status }) };

export interface ForumPageProps {
  threads?: ForumThreadSummary[];
  total?: number;
  loading?: boolean;
  client?: ForumClient;
}

function endpointFor(status: ForumStatusFilter): string {
  if (status === 'all') return `${FORUM_THREADS_ENDPOINT}?limit=50`;
  return `${FORUM_THREADS_ENDPOINT}?limit=50&status=${status}`;
}

function statusClass(status: string): string {
  if (status === 'answered') return 'border-ok-border bg-ok-bg text-ok-text';
  if (status === 'pending' || status === 'active') return 'border-warn-border bg-warn-bg text-warn-text';
  if (status === 'closed') return 'border-border bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md text-text-muted';
  return 'border-err-border bg-err-bg text-err-text';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <article className="min-w-0 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-accent">{value}</p>
      <p className="mt-1 text-sm text-text-muted">{detail}</p>
    </article>
  );
}

function ThreadCard({ thread }: { thread: ForumThreadSummary }) {
  return (
    <article className="min-w-0 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4 sm:p-5" aria-label={`Forum thread ${thread.id}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-muted">Thread #{thread.id}</p>
          <h3 className="mt-1 break-words text-lg font-semibold text-text">{thread.title}</h3>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(thread.status)}`}>
          <span aria-hidden="true">●</span>{thread.status}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-text-muted">Messages</dt>
          <dd className="font-mono text-text">{thread.message_count}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Created</dt>
          <dd className="font-mono text-text">{formatDate(thread.created_at)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">API</dt>
          <dd><a className="focus-ring break-all font-mono text-accent" href={`/api/thread/${thread.id}`}>/api/thread/{thread.id}</a></dd>
        </div>
      </dl>
      {thread.issue_url ? (
        <a className="focus-ring mt-3 inline-flex max-w-full break-all text-sm font-semibold text-accent" href={thread.issue_url} rel="noreferrer" target="_blank">
          Linked issue: {thread.issue_url}
        </a>
      ) : null}
    </article>
  );
}

export function ForumPage({ threads: initialThreads = EMPTY_THREADS, total: initialTotal, loading = true, client = defaultClient }: ForumPageProps) {
  const [status, setStatus] = useState<ForumStatusFilter>('all');
  const [threads, setThreads] = useState(initialThreads);
  const [total, setTotal] = useState(initialTotal ?? initialThreads.length);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    client.threads(status === 'all' ? undefined : status)
      .then((response) => {
        if (cancelled) return;
        setThreads(response.threads);
        setTotal(response.total);
        setState('ready');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState(initialThreads.length ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client, initialThreads.length, status]);

  const counts = useMemo(() => ({
    active: threads.filter((thread) => thread.status === 'active').length,
    pending: threads.filter((thread) => thread.status === 'pending').length,
    answered: threads.filter((thread) => thread.status === 'answered').length,
    closed: threads.filter((thread) => thread.status === 'closed').length,
  }), [threads]);
  const endpoint = endpointFor(status);

  return (
    <section className="grid min-w-0 gap-5" aria-labelledby="forum-page-title">
      <header className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Forum</p>
        <h1 id="forum-page-title" className="mt-2 text-3xl font-semibold text-text">Forum threads</h1>
        <p className="mt-2 text-sm text-text-muted">Operational conversations backed by GET {endpoint}.</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Thread status filters">
          {statusOptions.map((option) => (
            <button
              key={option}
              aria-pressed={status === option}
              className={`focus-ring rounded-xl border px-3 py-2 text-sm font-semibold capitalize ${status === option ? 'border-accent-border bg-ok-bg text-accent' : 'border-border text-text-muted hover:border-accent-border'}`}
              type="button"
              onClick={() => setStatus(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Forum summary">
        <Stat label="Threads" value={total} detail="total rows returned by the backend" />
        <Stat label="Active" value={counts.active} detail="open conversations" />
        <Stat label="Pending" value={counts.pending} detail="waiting on follow-up" />
        <Stat label="Answered" value={counts.answered} detail="resolved by Oracle" />
        <Stat label="Closed" value={counts.closed} detail="archived threads" />
      </div>

      {state === 'loading' ? <LoadingPanel title="Loading forum threads…" detail={`Fetching ${endpoint}.`} /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load forum threads." message={error} /> : null}
      {state !== 'error' && error ? <ErrorMessage title="Forum warning" message={error} /> : null}

      {threads.length ? (
        <div className="grid gap-3">{threads.map((thread) => <ThreadCard key={thread.id} thread={thread} />)}</div>
      ) : state === 'ready' ? (
        <p className="rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-5 text-sm text-text-muted">No forum threads match this filter.</p>
      ) : null}
    </section>
  );
}
