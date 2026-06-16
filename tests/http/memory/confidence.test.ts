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
});
