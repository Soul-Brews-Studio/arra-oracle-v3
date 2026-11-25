/**
 * The memory graph for the hub UI (#3110 graph view): documents, concepts, sources, vaults,
 * hub nodes and RETIRED.md rows as nodes; tagged_with, comes_from, synced_from, superseded_by,
 * joined and recorded_in / retires as edges. Kinds and edge names follow arraOntology(), so the
 * Graph view is an instance of what the Ontology view shows.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { sourceOf, SELF } from './status.ts';
import { dataDir, readConfig, readHubs, readHubState } from './state.ts';

export type GraphKind = 'Document' | 'Concept' | 'Source' | 'Vault' | 'Node' | 'RetiredEntry';
export interface GraphNode { id: string; kind: GraphKind; label: string; source?: string; type?: string; superseded?: boolean; detail?: string }
export interface GraphEdge { from: string; to: string; kind: string }
export interface MemoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; sources: string[]; omitted: { documents: number; concepts: number } }

interface DocRow { id: string; type: string; source_file: string; concepts: string; origin: string | null; superseded_by: string | null; content: string | null }

const titleOf = (content: string | null, file: string) =>
  (content?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || path.basename(file)).slice(0, 60);

function parseConcepts(raw: string): string[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim().toLowerCase()) : []; }
  catch { return []; }
}

/** RETIRED.md rows: | when | thing | why | successor | how to bring back | by | */
export function readRetired(file: string): Array<{ when: string; thing: string; why: string; successor: string; by: string }> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n')
    .filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}T/.test(l))
    .map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|')))
    .map(([when, thing, why, successor, , by]) => ({ when, thing, why, successor, by }));
}

export function buildGraph(sqlite: Database, opts: { source?: string; limit?: number } = {}, dir = dataDir()): MemoryGraph {
  const limit = Math.max(1, Math.min(opts.limit ?? 150, 1000));
  const where = opts.source === SELF ? "WHERE (d.origin IS NULL OR d.origin NOT LIKE 'hub:%')" : opts.source ? 'WHERE d.origin = ?' : '';
  const params = opts.source && opts.source !== SELF ? [opts.source] : [];
  const total = (sqlite.query(`SELECT COUNT(*) AS n FROM oracle_documents d ${where}`).get(...params) as { n: number }).n;
  const rows = sqlite.query(`SELECT d.id, d.type, d.source_file, d.concepts, d.origin, d.superseded_by, f.content
    FROM oracle_documents d LEFT JOIN oracle_fts f ON f.id = d.id ${where} ORDER BY d.indexed_at DESC LIMIT ?`).all(...params, limit) as DocRow[];

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const docId = (id: string) => `doc:${id}`;

  const conceptUse = new Map<string, number>();
  for (const r of rows) for (const c of new Set(parseConcepts(r.concepts))) conceptUse.set(c, (conceptUse.get(c) ?? 0) + 1);
  const minUse = rows.length > 40 ? 2 : 1;
  const kept = new Set([...conceptUse].filter(([, n]) => n >= minUse).map(([c]) => c));

  for (const r of rows) {
    const source = sourceOf(r.origin);
    add({ id: docId(r.id), kind: 'Document', label: titleOf(r.content, r.source_file), source, type: r.type, superseded: !!r.superseded_by, detail: r.id });
    add({ id: `source:${source}`, kind: 'Source', label: source });
    edges.push({ from: docId(r.id), to: `source:${source}`, kind: 'comes_from' });
    for (const c of new Set(parseConcepts(r.concepts))) if (kept.has(c)) {
      add({ id: `concept:${c}`, kind: 'Concept', label: c });
      edges.push({ from: docId(r.id), to: `concept:${c}`, kind: 'tagged_with' });
    }
  }
  for (const r of rows) if (r.superseded_by && nodes.has(docId(r.superseded_by))) edges.push({ from: docId(r.id), to: docId(r.superseded_by), kind: 'superseded_by' });

  const config = readConfig(dir);
  const vaultFiles: Array<{ id: string; file: string }> = [];
  for (const v of config?.vaults ?? []) {
    const id = `vault:${v.name}`;
    add({ id, kind: 'Vault', label: v.name, detail: 'local vault' });
    if (nodes.has(`source:hub:${v.name}`)) edges.push({ from: `source:hub:${v.name}`, to: id, kind: 'synced_from' });
    vaultFiles.push({ id, file: path.join(v.path, 'RETIRED.md') });
  }
  for (const h of readHubs(dir)) {
    const id = `vault:hub:${h.name}`;
    add({ id, kind: 'Vault', label: `${h.name} (on hub)`, detail: 'vault served by a joined hub' });
    if (nodes.has(`source:hub:${h.name}`)) edges.push({ from: `source:hub:${h.name}`, to: id, kind: 'synced_from' });
  }
  if (config?.hub) {
    const hubVault = config.vaults[0] ? `vault:${config.vaults[0].name}` : null;
    for (const n of readHubState(dir).nodes) {
      add({ id: `node:${n.id}`, kind: 'Node', label: n.label, detail: `${n.id} · ${n.status}` });
      if (hubVault) edges.push({ from: `node:${n.id}`, to: hubVault, kind: 'joined' });
    }
  }
  if (!config?.vaults.length) vaultFiles.push({ id: '', file: path.join(dir, 'RETIRED.md') });
  for (const { id, file } of vaultFiles) readRetired(file).forEach((row, i) => {
    const rid = `retired:${id || 'local'}:${i}`;
    add({ id: rid, kind: 'RetiredEntry', label: row.thing.slice(0, 48), detail: `${row.when} · ${row.why} · successor ${row.successor}` });
    if (id) edges.push({ from: rid, to: id, kind: 'recorded_in' });
    const named = row.thing.match(/hub node (\S+)/)?.[1];
    if (named && nodes.has(`node:${named}`)) edges.push({ from: rid, to: `node:${named}`, kind: 'retires' });
  });

  const sources = (sqlite.query(`SELECT DISTINCT COALESCE(origin, '') AS o FROM oracle_documents`).all() as Array<{ o: string }>)
    .map((r) => sourceOf(r.o || null));
  return {
    nodes: [...nodes.values()], edges, sources: [...new Set(sources)].sort(),
    omitted: { documents: Math.max(0, total - rows.length), concepts: conceptUse.size - kept.size },
  };
}
