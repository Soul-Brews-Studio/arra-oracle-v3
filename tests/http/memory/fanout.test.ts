import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createMemoryFanoutEndpoint, fuseRankedResults } from '../../../src/routes/memory/fanout.ts';
import { memoryConfidenceRerankConfig } from '../../../src/routes/memory/rerank-config.ts';
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

function confidenceFixture(): VectorQueryResult {
  return {
    ids: ['stale-duplicate', 'fresh-provenance'],
    documents: [
      'Oracle deploy confidence ranking note',
      'Oracle deploy confidence ranking note',
    ],
    distances: [0, 0.8],
    metadatas: [
      { type: 'memory', createdAt: '2020-01-01T00:00:00.000Z' },
      {
        type: 'memory',
        title: 'Fresh deploy note',
        source: 'session://codex-5',
        tags: ['deploy', 'confidence'],
        createdAt: '2026-06-17T00:00:00.000Z',
        updatedAt: '2026-06-17T00:00:00.000Z',
      },
    ],
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

test('GET /api/v1/memory/fanout clamps malformed vector distances before scoring', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => ({ alpha: models.alpha }),
    connect: async () => ({
      query: async () => ({
        ids: ['nan-distance', 'negative-distance'],
        documents: ['NaN distance memory', 'negative distance memory'],
        distances: [Number.NaN, -100],
        metadatas: [{ type: 'memory' }, { type: 'memory' }],
      }),
    }),
  }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle&limit=2'));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body.results).toHaveLength(2);
  for (const item of body.results as Array<{ score: unknown; confidence: { components: { match: unknown } } }>) {
    expect(typeof item.score).toBe('number');
    expect(Number.isFinite(item.score)).toBe(true);
    expect(item.score).toBeGreaterThanOrEqual(0);
    expect(item.score).toBeLessThanOrEqual(1);
    expect(typeof item.confidence.components.match).toBe('number');
  }
});

test('GET /api/v1/memory/fanout uses confidence to reorder fresh high-provenance matches', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => ({ alpha: models.alpha }),
    now: () => new Date('2026-06-17T00:00:00.000Z'),
    connect: async () => ({ query: async () => confidenceFixture() }),
  }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=oracle&limit=2'));
  const body = await json(response);

  expect(body.ranking).toMatchObject({
    strategy: 'confidence_weighted_rrf',
    rrfK: 60,
    confidenceWeight: 0.25,
    confidenceRerankingEnabled: true,
    confidenceWeightSource: 'default',
    confidenceSource: 'query-time-confidence',
  });
  expect(body.results.map((item: { id: string }) => item.id)).toEqual(['fresh-provenance', 'stale-duplicate']);
  expect(body.results[0].confidence.label).toBe('high');
  expect(body.results[0].rankingScore).toBeGreaterThan(body.results[1].rankingScore);
});

test('memory fanout confidence rerank config supports env tuning aliases and clamp bounds', () => {
  expect(memoryConfidenceRerankConfig({ ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT: '0' })).toMatchObject({
    enabled: false,
    confidenceWeight: 0,
    source: 'env',
    envKey: 'ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT',
  });
  expect(memoryConfidenceRerankConfig({ ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT: '0.8' })).toMatchObject({
    enabled: true,
    confidenceWeight: 0.8,
    envKey: 'ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT',
  });
  expect(memoryConfidenceRerankConfig({ ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT: '2' }).confidenceWeight).toBe(1);
  expect(memoryConfidenceRerankConfig({ ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT: '-1' }).confidenceWeight).toBe(0);
  expect(memoryConfidenceRerankConfig({ ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT: 'nope' })).toMatchObject({
    enabled: true,
    confidenceWeight: 0.25,
  });
});

test('fuseRankedResults can disable confidence weighting for pure RRF ordering', () => {
  const [first] = fuseRankedResults({ alpha: [
    {
      id: 'stale-duplicate',
      type: 'memory',
      content: 'Oracle deploy confidence ranking note',
      source_file: '',
      concepts: [],
      score: 1,
      createdAt: '2020-01-01T00:00:00.000Z',
    },
    {
      id: 'fresh-provenance',
      type: 'memory',
      content: 'Oracle deploy confidence ranking note',
      source_file: 'fresh.md',
      concepts: ['deploy'],
      score: 0.91,
      title: 'Fresh deploy note',
      tags: ['deploy', 'confidence'],
      memorySource: 'session://codex-5',
      createdAt: '2026-06-17T00:00:00.000Z',
    },
  ] }, 1, {
    confidenceWeight: 0,
    now: new Date('2026-06-17T00:00:00.000Z'),
  });

  expect(first.id).toBe('stale-duplicate');
  expect(first.confidenceWeight).toBe(0);
});

test('GET /api/v1/memory/fanout preserves supersede metadata from vector hits', async () => {
  const supersededAt = Date.parse('2026-06-16T10:00:00.000Z');
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => ({ alpha: models.alpha }),
    connect: async () => ({ query: async () => ({
      ids: ['old-memory'],
      documents: ['Legacy memory replaced by newer source.'],
      distances: [0],
      metadatas: [{
        type: 'memory',
        source_file: 'ψ/memory/old.md',
        superseded_by: 'new-memory',
        superseded_at: supersededAt,
        superseded_reason: 'newer source of truth',
      }],
    }) }),
  }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=legacy'));
  const body = await json(response) as { results: Array<Record<string, unknown>>; warnings?: string[] };

  expect(body.results[0]).toMatchObject({
    id: 'old-memory',
    superseded_by: 'new-memory',
    superseded_at: '2026-06-16T10:00:00.000Z',
    superseded_reason: 'newer source of truth',
    superseded: {
      by: 'new-memory',
      at: '2026-06-16T10:00:00.000Z',
      reason: 'newer source of truth',
    },
  });
  expect(body.warnings).toEqual(['result[1] superseded by new-memory: newer source of truth']);
});
