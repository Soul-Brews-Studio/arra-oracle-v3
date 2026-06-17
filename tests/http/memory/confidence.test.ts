import { expect, test } from 'bun:test';
import { memoryConfidence } from '../../../src/routes/memory/confidence.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';

const now = new Date('2026-06-16T00:00:00.000Z');

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: 'mem_confidence',
    content: 'Recover context before coding.',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

test('memoryConfidence is computed at query time from match, freshness, and provenance', () => {
  const confidence = memoryConfidence(memory({
    title: 'Boot context',
    tags: ['challenge-2'],
    source: 'morning-tape',
  }), { now, mode: 'semantic', semanticScore: 0.92 });

  expect(confidence).toMatchObject({
    label: 'high',
    score: 0.96,
    ageDays: 0,
    freshness: 1,
    components: {
      match: 0.92,
      freshness: 1,
      provenance: 1,
    },
    warnings: [],
  });
  expect(confidence.reasons).toContain('computed_at_query_time');
  expect(confidence.reasons).toContain('freshness_half_life_139d');
});

test('unanchored old memory decays without storing a confidence column', () => {
  const stale = memoryConfidence(memory({
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }), { now, mode: 'keyword' });

  expect(stale.label).toBe('low');
  expect(stale.freshness).toBeLessThan(0.05);
  expect(stale.reasons).toContain('source_missing');
  expect(stale.reasons).toContain('freshness_half_life_30d');
  expect(stale.warnings).toEqual(expect.arrayContaining([
    'missing_source',
    'missing_tags',
    'unanchored_memory',
    'stale_unvalidated',
  ]));
});

test('weak semantic matches expose warnings without storing confidence', () => {
  const confidence = memoryConfidence(memory({
    source: 'ψ/memory/design-principles-arra-oracle.md',
  }), { now, mode: 'semantic', semanticScore: 0.31 });

  expect(confidence.label).toBe('medium');
  expect(confidence.components).toMatchObject({
    match: 0.31,
    freshness: 1,
    provenance: 0.45,
  });
  expect(confidence.warnings).toEqual(expect.arrayContaining(['missing_tags', 'low_match_score']));
  expect(confidence.warnings).not.toContain('stale_unvalidated');
});


test('retrieval reinforcement boosts stale docs without removing decay warnings', () => {
  const staleBase = memory({
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const unused = memoryConfidence(staleBase, { now, mode: 'keyword' });
  const reinforced = memoryConfidence({
    ...staleBase,
    usageCount: 12,
    lastAccessedAt: '2026-06-15T00:00:00.000Z',
  }, { now, mode: 'keyword' });

  expect(reinforced.score).toBeGreaterThan(unused.score);
  expect(reinforced.usageCount).toBe(12);
  expect(reinforced.lastAccessedAgeDays).toBe(1);
  expect(reinforced.components.usage).toBeGreaterThan(0.5);
  expect(reinforced.reasons).toContain('retrieval_reinforced');
  expect(reinforced.warnings).toContain('stale_unvalidated');
});

test('malformed usage signals do not create NaN confidence or fake recency boosts', () => {
  const confidence = memoryConfidence(memory({
    usageCount: Number.NaN,
    lastAccessedAt: 'not-a-date',
  }), { now, mode: 'semantic', semanticScore: Number.POSITIVE_INFINITY });

  expect(confidence.usageCount).toBe(0);
  expect(confidence.lastAccessedAgeDays).toBeUndefined();
  expect(confidence.components.match).toBe(0);
  expect(confidence.components.usage).toBe(0);
  expect(Number.isFinite(confidence.score)).toBe(true);
});

test('confidence clamps malformed signals and future access without exploding score', () => {
  const confidence = memoryConfidence(memory({
    createdAt: 'not-a-date',
    updatedAt: 'not-a-date',
    usageCount: -4.9,
    lastAccessedAt: '2026-07-01T00:00:00.000Z',
  }), { now, mode: 'semantic', semanticScore: Number.POSITIVE_INFINITY });

  expect(confidence.score).toBeGreaterThanOrEqual(0);
  expect(confidence.score).toBeLessThanOrEqual(1);
  expect(confidence.components.match).toBe(0);
  expect(confidence.usageCount).toBe(0);
  expect(confidence.lastAccessedAgeDays).toBe(0);
  expect(confidence.reasons).toContain('source_missing');
  expect(confidence.warnings).toEqual(expect.arrayContaining(['missing_source', 'missing_tags']));
});
