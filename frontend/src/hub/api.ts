/**
 * Hub UI API client (#3110). Every call goes to routes the CLI and MCP already use:
 *   /api/v1/arra/*        owner API, loopback only: status, nodes, invite, revoke, search
 *   /api/v1/federation/hub public hub card (tailnet/LAN, no token): name, sha, node count
 * A 403 from /api/arra means "not the owner's machine"; the UI shows that instead of failing.
 */

export class OwnerOnlyError extends Error {
  constructor() { super('owner only: open this page on the hub machine (http://127.0.0.1:<port>/hub)'); }
}

export type NodeState = 'active' | 'expired' | 'revoked';

export interface HubNodeRow {
  id: string; label: string; url: string | null; joinedAt: string; expiresAt: string | null;
  lastSeenAt: string | null; lastIp: string | null; calls: number; status: string;
  state: NodeState; left: string; revokedAt?: string; revokeReason?: string;
}

export interface InviteRow {
  label: string; grant: string; createdAt: string; codeExpiresAt: string;
  usedAt: string | null; usedBy: string | null; state: 'open' | 'used' | 'expired';
}

export interface ArraStatus {
  name: string | null; initialized: boolean;
  docs: { total: number; bySource: Record<string, number> };
  embedder: { provider: string; model: string | null };
  vaults: Array<{ name: string; path: string; sha: string | null; dirty: boolean | null }>;
  hubs: Array<{ name: string; url: string; expiresAt: string | null; lastSyncAt: string | null }>;
  hub: { name: string; vault: string | null; nodes: number; invitesOpen: number } | null;
  snapshots: Array<{ file: string; bytes: number }>;
}

export interface PublicHub { hub: string; sha: string | null; nodes: number }

export interface SearchHit { n: number; id: string; title: string; score: number; snippet: string; source_file: string }
export interface SearchGroup { source: string; ranking: string; results: SearchHit[] }
export interface SearchResult { query: string; groups: SearchGroup[]; notes?: string[] }

export interface NewInvite { hub: string; code: string; label: string; grant: string; codeExpiresAt: string }

type Fetcher = typeof fetch;

async function call<T>(path: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<T> {
  const res = await fetcher(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (res.status === 403 && path.startsWith('/api/v1/arra')) throw new OwnerOnlyError();
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function createHubApi(fetcher: Fetcher = fetch) {
  return {
    status: () => call<ArraStatus>('/api/v1/arra/status', {}, fetcher),
    publicHub: () => call<PublicHub>('/api/v1/federation/hub', {}, fetcher),
    nodes: () => call<{ nodes: HubNodeRow[]; invites: InviteRow[] }>('/api/v1/arra/hub/nodes', {}, fetcher),
    invite: (grant: string, label: string) =>
      call<{ invite: NewInvite }>('/api/v1/arra/hub/invite', { method: 'POST', body: JSON.stringify({ for: grant, label }) }, fetcher),
    revoke: (id: string, why: string) =>
      call<{ node: string; revokedAt?: string }>('/api/v1/arra/hub/revoke', { method: 'POST', body: JSON.stringify({ id, why }) }, fetcher),
    search: (q: string) => call<SearchResult>(`/api/v1/arra/search?q=${encodeURIComponent(q)}&limit=10`, {}, fetcher),
  };
}

export type HubApi = ReturnType<typeof createHubApi>;
export const hubApi = createHubApi();
