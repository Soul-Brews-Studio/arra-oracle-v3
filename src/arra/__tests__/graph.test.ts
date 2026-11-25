/** buildGraph: documents, concepts, sources, vaults, hub nodes, supersede and RETIRED.md links. */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildGraph, readRetired } from '../graph.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-graph-'));
const vault = path.join(dir, 'vault');
fs.mkdirSync(vault);
fs.writeFileSync(path.join(dir, 'arra.json'), JSON.stringify({ version: 1, name: 'g', createdAt: 'x', vaults: [{ name: 'soul-brews', path: vault }], hub: { name: 'soul-brews' } }));
fs.writeFileSync(path.join(dir, 'hub-state.json'), JSON.stringify({ invites: [], nodes: [{ id: 'node-a-0001', label: 'node-a', status: 'revoked', expiresAt: null }] }));
fs.writeFileSync(path.join(vault, 'RETIRED.md'), '# RETIRED\n\n| when | thing | why | successor | how to bring back | by |\n|---|---|---|---|---|---|\n| 2026-11-25T00:51:37.366Z | hub node node-a-0001 (node-a) | left \\| moved | nothing | invite again | soul-brews |\n');

const db = new Database(':memory:');
db.run(`CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, type TEXT, source_file TEXT, concepts TEXT, origin TEXT, superseded_by TEXT, indexed_at INTEGER)`);
db.run(`CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts)`);
const put = (id: string, origin: string | null, concepts: string[], by: string | null, title: string, t: number) => {
  db.query('INSERT INTO oracle_documents VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'learning', `${id}.md`, JSON.stringify(concepts), origin, by, t);
  db.query('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(id, `# ${title}\nbody`, concepts.join(' '));
};
put('old', null, ['clay', 'Kiln'], 'new', 'Old way', 1);
put('new', null, ['clay'], null, 'New way', 2);
put('hub:soul-brews:shared/a.md', 'hub:soul-brews', ['clay'], null, 'Wedging clay', 3);

describe('buildGraph', () => {
  const g = buildGraph(db, {}, dir);
  const has = (id: string) => g.nodes.find((n) => n.id === id);
  const edge = (from: string, to: string, kind: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

  test('documents, concepts (lower-cased) and sources', () => {
    expect(has('doc:old')).toMatchObject({ kind: 'Document', label: 'Old way', source: 'self', superseded: true });
    expect(has('concept:kiln')).toBeTruthy();
    expect(edge('doc:old', 'concept:clay', 'tagged_with')).toBe(true);
    expect(edge('doc:hub:soul-brews:shared/a.md', 'source:hub:soul-brews', 'comes_from')).toBe(true);
    expect(g.sources).toEqual(['hub:soul-brews', 'self']);
  });
  test('supersede, vault, hub node and RETIRED links', () => {
    expect(edge('doc:old', 'doc:new', 'superseded_by')).toBe(true);
    expect(edge('source:hub:soul-brews', 'vault:soul-brews', 'synced_from')).toBe(true);
    expect(edge('node:node-a-0001', 'vault:soul-brews', 'joined')).toBe(true);
    const retired = g.nodes.find((n) => n.kind === 'RetiredEntry')!;
    expect(retired.detail).toContain('left | moved');
    expect(edge(retired.id, 'vault:soul-brews', 'recorded_in')).toBe(true);
    expect(edge(retired.id, 'node:node-a-0001', 'retires')).toBe(true);
  });
  test('every edge points at a node', () => {
    for (const e of g.edges) { expect(has(e.from)).toBeTruthy(); expect(has(e.to)).toBeTruthy(); }
  });
  test('filter by source and limit', () => {
    const shared = buildGraph(db, { source: 'hub:soul-brews' }, dir);
    expect(shared.nodes.filter((n) => n.kind === 'Document').map((n) => n.id)).toEqual(['doc:hub:soul-brews:shared/a.md']);
    const self = buildGraph(db, { source: 'self', limit: 1 }, dir);
    expect(self.nodes.filter((n) => n.kind === 'Document').map((n) => n.id)).toEqual(['doc:new']);
    expect(self.omitted.documents).toBe(1);
  });
  test('readRetired keeps escaped pipes inside a cell', () => {
    expect(readRetired(path.join(vault, 'RETIRED.md'))[0]).toMatchObject({ thing: 'hub node node-a-0001 (node-a)', why: 'left | moved', successor: 'nothing' });
  });
});
