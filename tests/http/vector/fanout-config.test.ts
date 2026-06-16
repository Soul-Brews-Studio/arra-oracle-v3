import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { QueryCache } from '../../../src/vector/query-cache.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const models = {
  local: { collection: 'local_docs', model: 'bge-m3', adapter: 'lancedb' as const },
  compressed: { collection: 'compressed_docs', model: 'bge-m3', adapter: 'turbovec' as const },
  spare: { collection: 'spare_docs', model: 'nomic', adapter: 'qdrant' as const },
};

function queryResult(id: string): VectorQueryResult {
  return {
    ids: [id],
    distances: [10],
    documents: [`${id} body`],
    metadatas: [{ type: 'note', source_file: `${id}.md` }],
  };
}

test('GET /api/v1/vector/fanout uses configured fanout selectors and strategy', async () => {
  const { createFanoutEndpoint } = await import('../../../src/routes/vector/fanout.ts');
  const calls: string[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createFanoutEndpoint({
    cache: new QueryCache<unknown>(),
    getFanoutConfig: () => ({ fanout: ['lancedb', 'turbovec', 'lancedb'], strategy: 'merge' }),
    getModels: () => models,
    getStore: async (key) => ({
      query: mock(async () => {
        calls.push(key);
        return queryResult(`${key}-doc`);
      }),
    }),
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/fanout?q=oracle&cache=false'),
  );
  const body = await res.json() as { strategy: string; backends: string[]; results: Array<{ id: string }> };

  expect(res.status).toBe(200);
  expect(body.strategy).toBe('merge');
  expect(body.backends).toEqual(['local', 'compressed']);
  expect(calls.sort()).toEqual(['compressed', 'local']);
  expect(body.results.map((item) => item.id).sort()).toEqual(['compressed-doc', 'local-doc']);
});
