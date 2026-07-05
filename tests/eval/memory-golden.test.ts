import { expect, test } from 'bun:test';
import { createApiVersionedFetch } from '../../src/middleware/api-version.ts';
import { createMemoryRoutes } from '../../src/routes/memory/index.ts';
import type { MemoryRecord, MemoryStore } from '../../src/routes/memory/store.ts';
import type { MemoryVectorHit, MemoryVectorIndex } from '../../src/routes/memory/vector.ts';

const fresh = new Date().toISOString();
const old = '2020-01-01T00:00:00.000Z';

type RankedResult = MemoryRecord & {
  confidence: { score: number; label: string };
  ranking: { score: number; components: Record<string, number> };
};
type SearchBody = { success: boolean; results: RankedResult[] };

class GoldenStore implements Partial<MemoryStore> {
  constructor(private readonly records: MemoryRecord[]) {}

  save() { throw new Error('unused'); }
  recall() { return []; }
  tierSummary() { throw new Error('unused'); }

  getByIds(ids: string[]) {
    const byId = new Map(this.records.map((item) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter((item): item is MemoryRecord => Boolean(item));
  }
}

class GoldenVectorIndex implements MemoryVectorIndex {
  constructor(private readonly hits: MemoryVectorHit[]) {}

  async index() { return { indexed: true as const }; }

  async search(_query: string, limit: number) {
    return this.hits.slice(0, limit);
  }
}

test('golden recall quality: known doc is found', async () => {
  const known = memory({
    id: 'known-doc',
    title: 'Solara handoff runbook',
    content: 'The Solara handoff stores the canonical memory ranking fixture.',
    tags: ['solara', 'handoff'],
    source: 'runbook://solara',
  });
  const distractor = memory({ id: 'distractor-doc', title: 'Other note' });

  const body = await search([known, distractor], [hit(known, 0.96), hit(distractor, 0.4)], 'solara handoff', 5);

  expect(body.success).toBe(true);
  expect(ids(body)).toContain('known-doc');
  expect(ids(body)[0]).toBe('known-doc');
});

test('golden stale-result suppression: superseded doc is not top-ranked', async () => {
  const superseded = memory({
    id: 'superseded-doc',
    title: 'Legacy deployment memory',
    content: 'Legacy deployment instructions that should no longer lead recall.',
    createdAt: old,
    updatedAt: old,
    validTo: '2024-01-01T00:00:00.000Z',
    supersededBy: 'replacement-doc',
    supersededAt: '2024-01-01T00:00:00.000Z',
  });
  const replacement = memory({
    id: 'replacement-doc',
    title: 'Current deployment memory',
    content: 'Current deployment instructions replace the stale memory.',
    tags: ['deploy', 'current'],
    source: 'runbook://deploy/current',
    usageCount: 12,
    lastAccessedAt: fresh,
  });

  const body = await search([superseded, replacement], [hit(superseded, 1), hit(replacement, 0.94)], 'deployment', 2);

  expect(ids(body)[0]).toBe('replacement-doc');
  expect(ids(body)[0]).not.toBe('superseded-doc');
  expect(byId(body, 'superseded-doc')?.ranking.components.validTime).toBe(0);
});

test('golden confidence ordering: high-confidence memory beats lower-confidence vector hit', async () => {
  const low = memory({
    id: 'low-confidence',
    content: 'Ranking answer without provenance or validation.',
    createdAt: old,
    updatedAt: old,
  });
  const high = memory({
    id: 'high-confidence',
    title: 'Validated ranking answer',
    content: 'Ranking answer with anchored provenance and repeated validation.',
    tags: ['validated', 'ranking'],
    source: 'session://validated-ranking',
    usageCount: 8,
    lastAccessedAt: fresh,
  });

  const body = await search([low, high], [hit(low, 0.99), hit(high, 0.9)], 'ranking answer', 2);

  expect(ids(body)[0]).toBe('high-confidence');
  expect(byId(body, 'high-confidence')!.confidence.score).toBeGreaterThan(byId(body, 'low-confidence')!.confidence.score);
});

test('golden entity boost: linked entity ranks above equal semantic match', async () => {
  const plain = memory({
    id: 'plain-entity-candidate',
    title: 'OracleNet deploy note',
    tags: ['oraclenet'],
    source: 'note://plain',
  });
  const linked = memory({
    id: 'linked-entity-candidate',
    title: 'OracleNet deploy note linked to entity',
    tags: ['oraclenet'],
    source: 'note://linked',
  });

  const body = await search(
    [plain, linked],
    [hit(plain, 0.9), hit(linked, 0.9, { entity_match_score: 1 })],
    'oraclenet deploy',
    2,
  );

  expect(ids(body)[0]).toBe('linked-entity-candidate');
  expect(byId(body, 'linked-entity-candidate')!.ranking.components.entity)
    .toBeGreaterThan(byId(body, 'plain-entity-candidate')!.ranking.components.entity);
});

test('golden heat decay: old untouched docs rank below recently used docs', async () => {
  const cold = memory({
    id: 'old-untouched-doc',
    title: 'Cache recovery note',
    tags: ['cache'],
    source: 'note://cache',
    createdAt: old,
    updatedAt: old,
  });
  const warm = memory({
    id: 'recently-used-doc',
    title: 'Cache recovery note',
    tags: ['cache'],
    source: 'note://cache',
    createdAt: old,
    updatedAt: old,
    usageCount: 20,
    lastAccessedAt: fresh,
  });

  const body = await search([cold, warm], [hit(cold, 0.9), hit(warm, 0.9)], 'cache recovery', 2);

  expect(ids(body)[0]).toBe('recently-used-doc');
  expect(byId(body, 'recently-used-doc')!.ranking.components.heat)
    .toBeGreaterThan(byId(body, 'old-untouched-doc')!.ranking.components.heat);
});

async function search(records: MemoryRecord[], hits: MemoryVectorHit[], query: string, limit: number): Promise<SearchBody> {
  const app = createMemoryRoutes(new GoldenStore(records) as MemoryStore, new GoldenVectorIndex(hits));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const response = await fetcher(new Request(`http://local/api/v1/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`));
  expect(response.status).toBe(200);
  return JSON.parse(await response.text()) as SearchBody;
}

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: crypto.randomUUID(),
    content: 'Memory ranking golden fixture.',
    createdAt: fresh,
    updatedAt: fresh,
    ...overrides,
  };
}

function hit(memory: MemoryRecord, score: number, metadata: Record<string, unknown> = {}): MemoryVectorHit {
  return {
    memoryId: memory.id,
    vectorId: `memory:${memory.id}`,
    document: memory.content,
    metadata: { type: 'memory', memoryId: memory.id, ...metadata },
    distance: 1 - score,
    score,
  };
}

function ids(body: SearchBody): string[] {
  return body.results.map((item) => item.id);
}

function byId(body: SearchBody, id: string): RankedResult | undefined {
  return body.results.find((item) => item.id === id);
}
