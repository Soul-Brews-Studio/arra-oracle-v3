import { expect, test } from 'bun:test';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord, MemoryStore } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorHit, MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const fresh = new Date().toISOString();

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    content: 'oracle confidence ranking memory',
    createdAt: overrides.createdAt ?? fresh,
    updatedAt: overrides.updatedAt ?? fresh,
    ...overrides,
  };
}

class RankingStore implements Partial<MemoryStore> {
  constructor(private readonly records: MemoryRecord[]) {}

  save() { throw new Error('unused'); }
  recall() { return []; }
  tierSummary() { throw new Error('unused'); }

  getByIds(ids: string[]) {
    const byId = new Map(this.records.map((item) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter((item): item is MemoryRecord => Boolean(item));
  }
}

class RankingVectorIndex implements MemoryVectorIndex {
  readonly requestedLimits: number[] = [];

  constructor(private readonly hits: MemoryVectorHit[]) {}

  async index() { return { indexed: true as const }; }

  async search(_query: string, limit: number) {
    this.requestedLimits.push(limit);
    return this.hits.slice(0, limit);
  }
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

test('GET /api/v1/memory/search ranks a wider candidate pool by confidence before slicing', async () => {
  const staleVectorWin = record({
    id: 'stale-vector-win',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  });
  const trustedFresh = record({
    id: 'trusted-fresh',
    title: 'Trusted fresh note',
    tags: ['deploy', 'confidence'],
    source: 'session://phase-1',
    usageCount: 20,
    lastAccessedAt: fresh,
  });
  const hits: MemoryVectorHit[] = [
    hit(staleVectorWin, 1),
    hit(trustedFresh, 0.93),
  ];
  const vector = new RankingVectorIndex(hits);
  const app = createMemoryRoutes(new RankingStore([staleVectorWin, trustedFresh]) as MemoryStore, vector);
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const response = await fetcher(new Request('http://local/api/v1/memory/search?q=oracle&limit=1'));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(vector.requestedLimits[0]).toBeGreaterThan(1);
  expect(body.ranking).toMatchObject({
    strategy: 'valid_time_confidence_heat_entity_match',
    candidatePool: vector.requestedLimits[0],
  });
  expect(body.results.map((item: MemoryRecord) => item.id)).toEqual(['trusted-fresh']);
  expect(body.results[0].ranking.components.confidence).toBeGreaterThan(0.9);
  expect(body.results[0].ranking.components.confidence).toBeLessThanOrEqual(1);
});

function hit(memory: MemoryRecord, score: number): MemoryVectorHit {
  return {
    memoryId: memory.id,
    vectorId: `memory:${memory.id}`,
    document: memory.content,
    metadata: { type: 'memory', memoryId: memory.id },
    distance: 1 - score,
    score,
  };
}
