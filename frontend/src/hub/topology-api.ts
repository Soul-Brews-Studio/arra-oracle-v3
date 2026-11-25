/** Live hub topology for the Topology tab (#3110): GET /api/v1/arra/topology, owner only. */

import { OwnerOnlyError, type HubNodeRow } from './api';

export interface Knock { count: number; lastAt: string | null }
export interface TopologyNode extends HubNodeRow { refused: Knock }
export interface OssieStatus {
  url: string; version: string; name: string; sha256: string;
  check: { ok: boolean; errors: string[]; concepts: number; relationships: number };
  official: { at: string; passed: boolean; ossieRef: string; sha256: string; from?: string; current: boolean } | null;
}
export interface Topology {
  at: string; viewer: 'owner'; privateNote: string;
  hub: { name: string; port: number | null; docs: number } | null;
  truth: { name: string; sha: string | null; dirty: boolean | null; committedAt: string | null } | null;
  nodes: TopologyNode[];
  door: { since: string; strangers: Knock; outside: Knock };
  ossie: OssieStatus;
}

type Fetcher = typeof fetch;

export function createTopologyApi(fetcher: Fetcher = fetch) {
  return {
    topology: async (): Promise<Topology> => {
      const res = await fetcher('/api/v1/arra/topology', { headers: { accept: 'application/json' } });
      if (res.status === 403) throw new OwnerOnlyError();
      const body = await res.json().catch(() => ({})) as Topology & { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    },
  };
}

export type TopologyApi = ReturnType<typeof createTopologyApi>;
export const topologyApi = createTopologyApi();
