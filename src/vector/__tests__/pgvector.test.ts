/**
 * PgVectorAdapter unit test.
 *
 * Runs against a live pgvector Postgres when TEST_PG_URL is set, e.g.:
 *   docker run -d --name pgv -e POSTGRES_USER=tekb -e POSTGRES_PASSWORD=tekb \
 *     -e POSTGRES_DB=tekb -p 5439:5432 pgvector/pgvector:pg16
 *   TEST_PG_URL=postgres://tekb:tekb@localhost:5439/tekb bun test src/vector/__tests__/pgvector.test.ts
 *
 * Skipped automatically when TEST_PG_URL is absent (no Postgres in plain CI).
 * Uses a deterministic fake embedder so no Ollama is required.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { PgVectorAdapter } from '../adapters/pgvector.ts';
import { closePgPool } from '../../db/pg.ts';
import type { EmbeddingProvider, EmbedType } from '../types.ts';

const TEST_PG_URL = process.env.TEST_PG_URL;
const d = TEST_PG_URL ? test : test.skip;

/** Deterministic hashing bag-of-words embedder (1024d, L2-normalized) — no GPU. */
class FakeEmbedder implements EmbeddingProvider {
  readonly name = 'fake';
  readonly dimensions = 1024;
  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array(this.dimensions).fill(0);
      const tokens = t.toLowerCase().split(/\s+/).filter(Boolean);
      for (const tok of tokens) {
        let h = 0x811c9dc5;
        for (let i = 0; i < tok.length; i++) {
          h ^= tok.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        vec[(h >>> 0) % this.dimensions] += 1;
      }
      let norm = 0;
      for (const v of vec) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      return vec.map((v) => v / norm);
    });
  }
}

const COLLECTION = 'test_pgvector_unit';
let adapter: PgVectorAdapter;

beforeAll(async () => {
  if (!TEST_PG_URL) return;
  adapter = new PgVectorAdapter(COLLECTION, new FakeEmbedder(), { connectionString: TEST_PG_URL });
  await adapter.connect();
  await adapter.deleteCollection(); // clean slate
  await adapter.ensureCollection();
});

afterAll(async () => {
  if (!TEST_PG_URL) return;
  await adapter.deleteCollection().catch(() => {});
  await closePgPool();
});

d('rejects an unsafe collection name', () => {
  expect(() => new PgVectorAdapter('bad name; DROP', new FakeEmbedder())).toThrow();
});

d('addDocuments + getStats: count reflects inserts', async () => {
  await adapter.addDocuments([
    { id: 'a1', document: 'payment refund failed on withdraw', metadata: { type: 'error', project: 'p1' } },
    { id: 'a2', document: 'พรุ่งนี้ประชุมทีมกี่โมง', metadata: { type: 'chat', project: 'p1' } },
    { id: 'a3', document: 'sunny weather tomorrow', metadata: { type: 'news', project: 'p2' } },
  ]);
  expect((await adapter.getStats()).count).toBe(3);
});

d('addDocuments upserts on id conflict (no duplicate)', async () => {
  await adapter.addDocuments([{ id: 'a1', document: 'updated text', metadata: { type: 'error', project: 'p1' } }]);
  expect((await adapter.getStats()).count).toBe(3);
});

d('respects precomputed vectors (no re-embed)', async () => {
  const vec = new Array(1024).fill(0);
  vec[7] = 1;
  await adapter.addDocuments([{ id: 'pre', document: 'ignored', metadata: { type: 'x' }, vector: vec }]);
  const all = await adapter.getAllEmbeddings();
  const got = all.embeddings[all.ids.indexOf('pre')];
  expect(got[7]).toBeCloseTo(1, 5);
});

d('query ranks the semantically closest doc first', async () => {
  const r = await adapter.query('refund withdraw payment', 3);
  expect(r.ids.length).toBeGreaterThan(0);
  expect(r.ids[0]).toBe('a1');
  // distances ascending (cosine distance)
  for (let i = 1; i < r.distances.length; i++) expect(r.distances[i - 1]).toBeLessThanOrEqual(r.distances[i]);
});

d('query honours a metadata where-filter', async () => {
  const r = await adapter.query('weather', 5, { project: 'p2' });
  expect(r.ids.length).toBeGreaterThan(0);
  expect(r.metadatas.every((m: any) => m.project === 'p2')).toBe(true);
});

d('Thai content is retrievable (UTF-8 round-trip)', async () => {
  const r = await adapter.query('ประชุมทีม', 3);
  expect(r.ids).toContain('a2');
});

d('queryById excludes the seed id', async () => {
  const r = await adapter.queryById('a1', 3);
  expect(r.ids).not.toContain('a1');
});

d('replaceDocuments swaps the whole collection', async () => {
  await adapter.replaceDocuments([
    { id: 'z1', document: 'only doc now', metadata: { type: 'solo' } },
  ]);
  const stats = await adapter.getStats();
  expect(stats.count).toBe(1);
  const all = await adapter.getAllEmbeddings();
  expect(all.ids).toEqual(['z1']);
});
