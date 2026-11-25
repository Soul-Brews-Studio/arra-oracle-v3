/** Graph + ontology calls for the hub UI (#3110 graph view); same owner-only /api/arra routes. */

import { OwnerOnlyError } from './api';

export interface GraphNode { id: string; kind: string; label: string; source?: string; type?: string; superseded?: boolean; detail?: string }
export interface GraphEdge { from: string; to: string; kind: string }
export interface MemoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; sources: string[]; omitted: { documents: number; concepts: number } }
export interface SchemaGraph {
  nodes: Array<{ id: string; kind: 'EntityType' | 'ValueType' | 'BuiltIn'; label: string; description?: string; extends?: string[] }>;
  edges: Array<{ from: string; to: string; label: string; multiplicity?: string; kind: string }>;
}
export interface OssieDoc {
  version: string; name: string; description?: string;
  ontology: Array<{ concept: string; type: string; description?: string; identify_by?: string[]; requires?: string[]; relationships?: Array<{ name: string; multiplicity?: string; verbalizes: string[] }> }>;
}
export interface ReadDoc { id: string; title: string; source: string; type: string; source_file: string; created_by: string | null; superseded_by: string | null; content: string }

type Fetcher = typeof fetch;

async function get<T>(path: string, fetcher: Fetcher): Promise<T> {
  const res = await fetcher(path, { headers: { accept: 'application/json' } });
  if (res.status === 403) throw new OwnerOnlyError();
  const body = await res.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const OSSIE_URL = '/api/v1/arra/ontology?format=ossie';

export function createGraphApi(fetcher: Fetcher = fetch) {
  return {
    graph: (source: string, limit: number) =>
      get<MemoryGraph>(`/api/v1/arra/graph?limit=${limit}${source ? `&source=${encodeURIComponent(source)}` : ''}`, fetcher),
    schema: () => get<SchemaGraph>('/api/v1/arra/ontology?format=graph', fetcher),
    ossie: () => get<OssieDoc>(OSSIE_URL, fetcher),
    read: async (id: string) => (await get<{ doc: ReadDoc }>(`/api/v1/arra/read?id=${encodeURIComponent(id)}`, fetcher)).doc,
  };
}

export type GraphApi = ReturnType<typeof createGraphApi>;
export const graphApi = createGraphApi();
