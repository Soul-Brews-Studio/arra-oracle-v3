import { apiFetch } from '../api';

export const FORUM_THREADS_ENDPOINT = '/api/threads';
export const FORUM_THREAD_STATUSES = ['active', 'answered', 'pending', 'closed'] as const;
export type ForumThreadStatus = typeof FORUM_THREAD_STATUSES[number];

export interface ForumThreadSummary {
  id: number;
  title: string;
  status: ForumThreadStatus | string;
  message_count: number;
  created_at: string;
  issue_url?: string | null;
}

export interface ForumThreadsResponse {
  threads: ForumThreadSummary[];
  total: number;
}

type ForumThreadQuery = { status?: ForumThreadStatus; limit?: number; offset?: number };

function toThread(value: unknown): ForumThreadSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'number' ? row.id : Number(row.id);
  if (!Number.isSafeInteger(id)) return null;
  const messageCount = typeof row.message_count === 'number' ? row.message_count : Number(row.message_count ?? 0);
  return {
    id,
    title: typeof row.title === 'string' && row.title.trim() ? row.title : `Thread ${id}`,
    status: typeof row.status === 'string' ? row.status : 'active',
    message_count: Number.isFinite(messageCount) ? messageCount : 0,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    issue_url: typeof row.issue_url === 'string' ? row.issue_url : null,
  };
}

function forumThreadsPath(query: ForumThreadQuery = {}): string {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 50));
  if (query.offset) params.set('offset', String(query.offset));
  if (query.status) params.set('status', query.status);
  return `${FORUM_THREADS_ENDPOINT}?${params}`;
}

export async function fetchForumThreads(query: ForumThreadQuery = {}): Promise<ForumThreadsResponse> {
  const path = forumThreadsPath(query);
  const response = await apiFetch(path, { headers: { accept: 'application/json' } });
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : response.statusText;
    throw new Error(`${path} returned ${response.status}: ${message}`);
  }
  const payload = body as Partial<ForumThreadsResponse>;
  const threads = Array.isArray(payload.threads) ? payload.threads.map(toThread).filter((item): item is ForumThreadSummary => Boolean(item)) : [];
  const total = typeof payload.total === 'number' && Number.isFinite(payload.total) ? payload.total : threads.length;
  return { threads, total };
}
