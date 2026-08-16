/**
 * How the pointer fast path treats superseded documents.
 *
 * The pointer index is a recall path, not a visibility policy. `handleSearch` merges pointer
 * hits into the same array as FTS and vector hits, then runs `enrichSupersedeFlags` over the
 * merged array (`src/tools/search/handler.ts`), so a superseded document is *returned and
 * labelled* whichever path recalled it — the same contract
 * `src/tools/__tests__/search-supersede.test.ts` pins for FTS.
 *
 * Excluding superseded documents is `asOf`'s job, and only `asOf`'s job:
 * `filterResultsAsOf` runs over the merged array too, so it can weigh a document's whole
 * valid-time interval. A `supersededAt IS NULL` filter inside `hydratePointerDocs` would drop
 * the row *before* that filter ever sees it, which is why the last two tests here are a pair —
 * a document must be reachable at a timestamp when it was live and gone at one when it wasn't.
 * This file exists because that filter was proposed in PR #2998 and nothing was red.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../db/index.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import { oracleDocuments } from '../../db/schema.ts';
import { handleSearch } from '../../tools/search.ts';
import type { ToolContext } from '../../tools/types.ts';
import { replaceDocumentPointers } from '../pointer-index.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
const created = Date.parse('2026-01-01T00:00:00.000Z');
const superseded = Date.parse('2026-06-05T12:00:00.000Z');

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arra-pointer-supersede-'));
  roots.push(dir);
  return dir;
}

function ctx(): ToolContext {
  const conn = createDatabase(join(tempRoot(), 'oracle.db'));
  connections.push(conn);
  return {
    db: conn.db,
    sqlite: conn.sqlite,
    repoRoot: tempRoot(),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test',
  };
}

/**
 * A superseded document reachable by pointer alone.
 *
 * Its FTS row deliberately carries none of the query's terms, so an FTS5 MATCH cannot return
 * it. Anything the search does return for `Ledger Rotation` arrived through the pointer index,
 * which is what makes these assertions about the pointer path rather than about FTS.
 */
function seedPointerOnly(context: ToolContext): void {
  context.db.insert(oracleDocuments).values({
    id: 'rotation-note',
    type: 'learning',
    sourceFile: 'ψ/memory/learnings/rotation.md',
    concepts: JSON.stringify(['Ledger Rotation']),
    createdAt: created,
    updatedAt: created,
    indexedAt: created,
    supersededAt: superseded,
    supersededBy: 'rotation-note-v2',
    supersededReason: 'rewritten after the 06-05 incident',
  }).run();
  context.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('rotation-note', 'opaque body sharing no term with the query', 'unrelated');
  replaceDocumentPointers(context.sqlite, {
    documentId: 'rotation-note',
    content: 'Ledger Rotation runbook',
    concepts: ['Ledger Rotation'],
    timestamp: created,
  });
}

async function search(context: ToolContext, asOf?: string) {
  const response = await handleSearch(context, {
    query: 'Ledger Rotation',
    mode: 'fts',
    limit: 5,
    ...(asOf ? { asOf } : {}),
  });
  return JSON.parse(response.content[0].text);
}

afterEach(() => {
  for (const conn of connections.splice(0)) conn.storage.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('a superseded document recalled only by pointer is still returned', async () => {
  const context = ctx();
  seedPointerOnly(context);

  const body = await search(context);

  expect(body.results.map((result: { id: string }) => result.id)).toEqual(['rotation-note']);
  expect(body.results[0].provenance.source).toBe('pointer');
  expect(body.metadata.pointerIndex.hits).toBe(1);
});

test('a superseded pointer hit carries its successor, not silence', async () => {
  // Dropping the row would take this warning with it: the caller would lose both the stale
  // answer and the pointer to the fresh one.
  const context = ctx();
  seedPointerOnly(context);

  const body = await search(context);

  expect(body.results[0]).toMatchObject({
    superseded_by: 'rotation-note-v2',
    superseded_reason: 'rewritten after the 06-05 incident',
  });
  expect(body.results[0].superseded_at).toMatch(/T.*Z$/);
});

test('asOf before the supersession still reaches the pointer-only document', async () => {
  const context = ctx();
  seedPointerOnly(context);

  const body = await search(context, '2026-03-01T00:00:00.000Z');

  expect(body.results.map((result: { id: string }) => result.id)).toEqual(['rotation-note']);
  expect(body.results[0].valid_until).toMatch(/^2026-06-05/);
});

test('asOf after the supersession drops it — exclusion is asOf, not hydration', async () => {
  const context = ctx();
  seedPointerOnly(context);

  const body = await search(context, '2026-08-01T00:00:00.000Z');

  expect(body.results).toEqual([]);
});
