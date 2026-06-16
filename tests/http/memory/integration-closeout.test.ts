import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleDocuments, oracleMemories, sqlite } from '../../../src/db/index.ts';
import { readLearningDocuments, storeSqliteDocuments } from '../../../src/indexer/learn-doc-source.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const root = join(tmpdir(), `arra-memory-closeout-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const memoryIds: string[] = [];
const docIds: string[] = [];

class CloseoutVectorIndex implements MemoryVectorIndex {
  readonly memories: MemoryRecord[] = [];

  async index(memory: MemoryRecord) {
    this.memories.push(memory);
    return { indexed: true as const };
  }

  async search(query: string, limit: number) {
    const q = query.toLowerCase();
    return this.memories
      .filter((memory) => [memory.title, memory.content, memory.source, ...(memory.tags ?? [])]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
      .slice(0, limit)
      .map((memory, index) => ({
        memoryId: memory.id,
        vectorId: `memory:${memory.id}`,
        document: memory.content,
        metadata: { type: 'memory', memoryId: memory.id },
        distance: index * 0.1,
        score: 1 - index * 0.1,
      }));
  }
}

function fetcher(index = new CloseoutVectorIndex()) {
  const app = createMemoryRoutes(undefined, index);
  return createApiVersionedFetch((request) => app.handle(request));
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

afterAll(() => {
  if (memoryIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, memoryIds)).run();
  if (docIds.length) {
    db.delete(oracleDocuments).where(inArray(oracleDocuments.id, docIds)).run();
    for (const id of docIds) sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  }
  rmSync(root, { recursive: true, force: true });
});

test('memory CRUD, learn indexing, and morning tape share close-out context', async () => {
  const unique = `challenge2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const learnDir = join(root, 'ψ', 'learn');
  mkdirSync(learnDir, { recursive: true });
  const learnFile = join(learnDir, 'memory-closeout.md');
  writeFileSync(learnFile, `## Integration proof\nLearn indexer stores ${unique} for morning recovery.`);

  const docs = readLearningDocuments(root, learnFile);
  const indexedIds = storeSqliteDocuments(sqlite, docs);
  docIds.push(...indexedIds);

  expect(indexedIds.length).toBeGreaterThan(0);
  const indexed = db.select().from(oracleDocuments).where(inArray(oracleDocuments.id, indexedIds)).all();
  expect(indexed[0]).toMatchObject({ type: 'learning', sourceFile: 'ψ/learn/memory-closeout.md' });
  const fts = sqlite.query<{ content: string }, [string]>('SELECT content FROM oracle_fts WHERE id = ?').get(indexedIds[0]);
  expect(fts?.content).toContain(unique);

  const api = fetcher();
  const save = await api(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Challenge 2 boot context',
      content: `Morning tape must recover ${unique} after learn doc ${indexedIds[0]} is indexed.`,
      tags: ['challenge-2', 'integration'],
      source: 'closeout-test',
    }),
  }));
  const saved = await json(save);
  memoryIds.push(saved.memory.id);

  expect(save.status).toBe(200);
  expect(saved.vector).toMatchObject({ indexed: true });

  const recall = await json(await api(new Request(`http://local/api/v1/memory/recall?q=${unique}&limit=5`)));
  expect(recall).toMatchObject({ total: 1 });
  expect(recall.items[0].id).toBe(saved.memory.id);

  const search = await json(await api(new Request(`http://local/api/v1/memory/search?q=${unique}&limit=5`)));
  expect(search).toMatchObject({ success: true, total: 1 });
  expect(search.results[0]).toMatchObject({ id: saved.memory.id, vectorId: `memory:${saved.memory.id}` });

  const tape = await (await api(new Request('http://local/api/v1/memory/morning-tape?format=markdown&limit=5'))).text();
  expect(tape).toStartWith('# MORNING-TAPE');
  expect(tape).toContain(unique);
  expect(tape).toContain(indexedIds[0]);
});
