import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createMemoryFanoutEndpoint } from '../../../src/routes/memory/fanout.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const models: Record<string, EmbeddingModelConfig> = {
  alpha: { collection: 'alpha_docs', model: 'alpha-embed' },
  beta: { collection: 'beta_docs', model: 'beta-embed' },
};

function result(ids: string[]): VectorQueryResult {
  return {
    ids,
    documents: ids.map((id) => `${id} document`),
    distances: ids.map((_, index) => index * 10),
    metadatas: ids.map((id) => ({ type: 'memory', source_file: `${id}.md` })),
  };
}

function createFetch(responses: Record<string, VectorQueryResult | Error>) {
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => models,
    connect: async (key) => ({
      query: async () => {
        const response = responses[key];
        if (response instanceof Error) throw response;
        return response;
      },
    }),
  }));
  return createApiVersionedFetch((request) => app.handle(request));
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

test('GET /api/v1/memory/fanout queries all collections and rank-fuses results', async () => {
  const fetcher = createFetch({
    alpha: result(['shared', 'alpha-only']),
    beta: result(['beta-only', 'shared']),
  });
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle&limit=3'));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    query: 'oracle',
    strategy: 'reciprocal_rank_fusion',
    collections: ['alpha', 'beta'],
    totalCollections: 2,
    errors: {},
    cost: { inputTokens: 2, vectorQueries: 2, embeddingCalls: 2, estimatedTokenUnits: 4 },
  });
  expect(body.results[0]).toMatchObject({ id: 'shared', source: 'hybrid' });
  expect(body.results[0].matches.map((match: { collection: string }) => match.collection)).toEqual(['alpha', 'beta']);
});

test('GET /api/v1/memory/fanout preserves partial collection errors', async () => {
  const fetcher = createFetch({
    alpha: result(['alpha-only']),
    beta: new Error('beta unavailable'),
  });
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle'));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body.results).toHaveLength(1);
  expect(body.errors).toEqual({ beta: 'beta unavailable' });
});
