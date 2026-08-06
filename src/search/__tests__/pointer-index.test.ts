import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../db/index.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import { storeDocuments } from '../../indexer/storage.ts';
import { handleSearch } from '../../tools/search.ts';
import type { ToolContext } from '../../tools/types.ts';
import { documentPointers, queryPointerIndex, replaceDocumentPointers } from '../pointer-index.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
const stamp = Date.parse('2026-06-05T12:00:00.000Z');

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arra-pointer-index-'));
  roots.push(dir);
  return dir;
}

function connection(): DatabaseConnection {
  const conn = createDatabase(join(tempRoot(), 'oracle.db'));
  connections.push(conn);
  return conn;
}

function ctx(conn: DatabaseConnection): ToolContext {
  return {
    db: conn.db,
    sqlite: conn.sqlite,
    repoRoot: tempRoot(),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test',
  };
}

afterEach(() => {
  for (const conn of connections.splice(0)) conn.storage.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('documentPointers emits compact topic, entity, and date keys', () => {
  const pointers = documentPointers({
    documentId: 'doc-1',
    content: 'Cloudflare Workers deploy Arra Oracle in 2026.',
    concepts: ['Edge Runtime'],
    timestamp: stamp,
  });

  expect(pointers).toContainEqual({ kind: 'topic', key: 'edge-runtime', label: 'Edge Runtime' });
  expect(pointers).toContainEqual({ kind: 'entity', key: 'cloudflare-workers', label: 'Cloudflare Workers' });
  expect(pointers).toContainEqual({ kind: 'date', key: '2026-06', label: '2026-06' });
});

test('storeDocuments maintains the pointer index for cheap entity and date lookup', async () => {
  const conn = connection();
  await storeDocuments(conn.sqlite, conn.db, null, null, [{
    id: 'pointer-doc',
    type: 'learning',
    source_file: 'ψ/memory/learnings/pointer.md',
    concepts: ['Cloudflare Workers'],
    content: 'Closet pointer index routes entity and date recalls before embeddings.',
    created_at: stamp,
    updated_at: stamp,
  }]);

  const results = queryPointerIndex(conn.sqlite, { query: 'Cloudflare Workers 2026-06', limit: 5 });
  expect(results.map((result) => result.id)).toEqual(['pointer-doc']);
  expect(results[0].pointerMatches).toEqual(expect.arrayContaining(['Cloudflare Workers', '2026-06']));
});

test('oracle_search surfaces pointer-only hits when FTS misses', async () => {
  const conn = connection();
  conn.db.insert((await import('../../db/schema.ts')).oracleDocuments).values({
    id: 'pointer-only',
    type: 'learning',
    sourceFile: 'ψ/memory/learnings/pointer-only.md',
    concepts: JSON.stringify(['Cloudflare Workers']),
    createdAt: stamp,
    updatedAt: stamp,
    indexedAt: stamp,
  }).run();
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('pointer-only', 'opaque runbook without query terms', 'unrelated');
  replaceDocumentPointers(conn.sqlite, {
    documentId: 'pointer-only',
    content: 'Cloudflare Workers deploy note',
    concepts: ['Cloudflare Workers'],
    timestamp: stamp,
  });

  const response = await handleSearch(ctx(conn), { query: 'Cloudflare Workers 2026-06', mode: 'fts', limit: 3 });
  const body = JSON.parse(response.content[0].text);

  expect(body.results.map((result: { id: string }) => result.id)).toEqual(['pointer-only']);
  expect(body.results[0]).toMatchObject({
    source: 'pointer',
    provenance: { pointer_matches: expect.arrayContaining(['Cloudflare Workers', '2026-06']) },
  });
  expect(body.metadata.pointerIndex).toMatchObject({
    enabled: true,
    strategy: 'topic_entity_date_pointer_fast_path',
    hits: 1,
  });
});
