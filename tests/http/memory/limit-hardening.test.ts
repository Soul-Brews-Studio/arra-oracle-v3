import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createMemoryFanoutEndpoint } from '../../../src/routes/memory/fanout.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord, MemoryStore } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const memory: MemoryRecord = {
  id: 'mem_limit',
  content: 'Limit hardening memory.',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

function memoryHarness() {
  const recallLimits: number[] = [];
  const searchLimits: number[] = [];
  const store = {
    save: () => memory,
    recall: (_query = '', limit = 10) => {
      recallLimits.push(limit);
      return [memory];
    },
    getByIds: () => [],
  } as unknown as MemoryStore;
  const vectorIndex: MemoryVectorIndex = {
    async index() { return { indexed: true }; },
    async search(_query, limit) { searchLimits.push(limit); return []; },
  };
  const app = createMemoryRoutes(store, vectorIndex);
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), recallLimits, searchLimits };
}

function fanoutHarness() {
  const limits: number[] = [];
  const models: Record<string, EmbeddingModelConfig> = { alpha: { collection: 'alpha', model: 'alpha' } };
  const empty: VectorQueryResult = { ids: [], documents: [], metadatas: [], distances: [] };
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => models,
    connect: async () => ({ query: async (_query, limit) => { limits.push(limit); return empty; } }),
  }));
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), limits };
}

test('memory routes fall back from malformed limit query values', async () => {
  const { fetcher, recallLimits, searchLimits } = memoryHarness();
  await fetcher(new Request('http://local/api/v1/memory/morning-tape?limit=nope'));
  await fetcher(new Request('http://local/api/v1/memory/recall?limit=nope'));
  await fetcher(new Request('http://local/api/v1/memory/search?q=oracle&limit=nope'));

  expect(recallLimits).toEqual([8, 10]);
  expect(searchLimits).toEqual([10]);
});

test('memory routes clamp out-of-range limit query values', async () => {
  const { fetcher, recallLimits, searchLimits } = memoryHarness();
  await fetcher(new Request('http://local/api/v1/memory/morning-tape?limit=999'));
  await fetcher(new Request('http://local/api/v1/memory/recall?limit=0'));
  await fetcher(new Request('http://local/api/v1/memory/search?q=oracle&limit=999'));

  expect(recallLimits).toEqual([25, 1]);
  expect(searchLimits).toEqual([50]);
});

test('memory fanout normalizes malformed and large limits', async () => {
  const { fetcher, limits } = fanoutHarness();
  await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle&limit=nope'));
  await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle&limit=999'));

  expect(limits).toEqual([10, 50]);
});
