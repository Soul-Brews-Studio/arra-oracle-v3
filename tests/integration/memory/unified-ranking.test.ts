import { describe, expect, test } from 'bun:test';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord, MemoryStore } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorHit, MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

type RankedMemory = MemoryRecord & {
  ranking: {
    score: number;
    strategy: string;
    components: { match: number; confidence: number; heat: number; validTime: number; entity: number };
  };
};

const now = Date.now();
const asOf = new Date(now).toISOString();

function iso(daysAgo: number): string {
  return new Date(now - (daysAgo * 86_400_000)).toISOString();
}

function memory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    content: `${id} unified ranking memory`,
    createdAt: iso(200),
    updatedAt: iso(200),
    ...overrides,
  };
}

const records = new Map<string, MemoryRecord>([
  ['high-match-only', memory('high-match-only', {
    content: 'High semantic match without heat, confidence provenance, or entity sidecar support.',
    validFrom: iso(2),
    updatedAt: iso(2),
  })],
  ['entity-only', memory('entity-only', {
    title: 'Entity sidecar hit',
    source: 'entity-sidecar',
    tags: ['oracle', 'entity'],
    validFrom: iso(160),
    updatedAt: iso(30),
  })],
  ['hot-expired', memory('hot-expired', {
    title: 'Hot but expired',
    source: 'old-policy',
    tags: ['oracle', 'heat'],
    validFrom: iso(400),
    validTo: iso(1),
    usageCount: 25,
    lastAccessedAt: iso(0),
    updatedAt: iso(5),
  })],
  ['unified-winner', memory('unified-winner', {
    title: 'Unified memory ranking',
    source: 'issue-2251',
    tags: ['oracle', 'entity', 'confidence'],
    validFrom: iso(1),
    usageCount: 18,
    lastAccessedAt: iso(0),
    updatedAt: iso(1),
  })],
]);

const hits: MemoryVectorHit[] = [
  hit('high-match-only', 0.99, 0),
  hit('hot-expired', 0.45, 0.4),
  hit('entity-only', 0.65, 0.98),
  hit('unified-winner', 0.78, 0.9),
];

function hit(memoryId: string, score: number, entityScore: number): MemoryVectorHit {
  return {
    memoryId,
    vectorId: `memory:${memoryId}`,
    document: records.get(memoryId)?.content ?? '',
    metadata: { memoryId, type: 'memory', entityScore },
    distance: 1 - score,
    score,
  };
}

const store = {
  getByIds(ids: string[]) {
    return ids.map((id) => records.get(id)).filter((record): record is MemoryRecord => Boolean(record));
  },
} as unknown as MemoryStore;

const vectorIndex: MemoryVectorIndex = {
  async index() { return { indexed: true }; },
  async search() { return hits; },
};

describe('unified memory ranking integration (#2251)', () => {
  test('combines heat, valid-time, confidence, and entity sidecar scores into ordering', async () => {
    const app = createMemoryRoutes(store, vectorIndex);
    const res = await app.handle(new Request(`http://local/api/memory/search?q=oracle&limit=4&asOf=${encodeURIComponent(asOf)}`));
    const body = await res.json() as { success: boolean; results: RankedMemory[] };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results.map((result) => result.id)).toEqual([
      'unified-winner',
      'high-match-only',
      'entity-only',
      'hot-expired',
    ]);

    const [winner, highMatch, entityOnly, expired] = body.results;
    expect(winner.ranking.strategy).toBe('valid_time_confidence_heat_entity_match');
    expect(winner.ranking.components.match).toBeGreaterThan(0.7);
    expect(winner.ranking.components.confidence).toBeGreaterThan(0.85);
    expect(winner.ranking.components.heat).toBeGreaterThan(0.85);
    expect(winner.ranking.components.validTime).toBeGreaterThan(0.85);
    expect(winner.ranking.components.entity).toBeGreaterThan(0.85);
    expect(highMatch.ranking.components.match).toBeGreaterThan(winner.ranking.components.match);
    expect(entityOnly.ranking.components.entity).toBeGreaterThan(winner.ranking.components.entity);
    expect(expired.ranking.components.validTime).toBe(0);
    expect(winner.ranking.score).toBeGreaterThan(highMatch.ranking.score);
  });
});
