/** Pure display helpers for the hub UI; tested in tests/frontend/hub/. */

import type { NodeState } from './api';

export const GRANTS = ['15m', '1h', '7d', 'forever'] as const;
export type Grant = typeof GRANTS[number];

export const TABS = ['status', 'topology', 'nodes', 'search', 'graph', 'ontology', 'invite'] as const;
export type Tab = typeof TABS[number];

export function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#\/?/, '');
  return (TABS as readonly string[]).includes(name) ? name as Tab : 'status';
}

/** 100.111.101.21 → 100.x.x.x; fd7a:115c:a1e0::1 → fd7a:x; anything else unchanged. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '-';
  const v4 = ip.replace(/^::ffff:/, '').match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x.x.x`;
  if (ip.includes(':')) return `${ip.split(':')[0]}:x`;
  return ip;
}

/** Hide host parts of a URL (http://100.1.2.3:47778 → http://100.x.x.x:47778). */
export function maskUrl(url: string | null | undefined): string {
  if (!url) return '-';
  try {
    const u = new URL(url);
    const host = /^[\d.]+$/.test(u.hostname) ? maskIp(u.hostname) : `${u.hostname.split('.')[0].slice(0, 1)}…`;
    return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}`;
  } catch { return '-'; }
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return '-';
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Studio Badge tone for a node or invite state. */
export function stateTone(state: NodeState | string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'active' || state === 'open') return 'success';
  if (state === 'expired') return 'warning';
  if (state === 'used') return 'neutral';
  return 'danger';
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '-';
}
