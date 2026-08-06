import { expect, test } from 'bun:test';
import { rankMemories } from '../../../src/routes/memory/rank.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';

const now = new Date('2026-06-17T00:00:00.000Z');

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    content: overrides.content ?? 'shared ranking context',
    tags: overrides.tags ?? ['rank'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('rankMemories combines vector score, confidence, heat, and valid-time recency', () => {
  const staleHot = memory({
    id: 'stale-hot',
    validFrom: '2024-01-01T00:00:00.000Z',
    usageCount: 20,
    lastAccessedAt: '2026-06-16T00:00:00.000Z',
  });
  const currentRelevant = memory({
    id: 'current-relevant',
    validFrom: '2026-06-01T00:00:00.000Z',
    source: 'issue-2251',
  });

  const ranked = rankMemories([staleHot, currentRelevant], {
    mode: 'semantic',
    now,
    asOf: now.toISOString(),
    score: (item) => item.id === 'current-relevant' ? 0.92 : 0.52,
  });

  expect(ranked.map((item) => item.id)).toEqual(['current-relevant', 'stale-hot']);
  expect(ranked[0].ranking.strategy).toBe('valid_time_confidence_heat_entity_match');
  expect(ranked[0].ranking.components).toMatchObject({ match: 0.92 });
  expect(ranked[0].ranking.components.entity).toBe(0);
  expect(ranked[1].ranking.components.heat).toBeGreaterThan(0.8);
});

test('rankMemories keeps inactive valid-time rows below active rows', () => {
  const expired = memory({
    id: 'expired',
    validFrom: '2024-01-01T00:00:00.000Z',
    validTo: '2025-01-01T00:00:00.000Z',
    source: 'old-policy',
  });
  const active = memory({ id: 'active', validFrom: '2025-01-01T00:00:00.000Z' });

  const ranked = rankMemories([expired, active], {
    now,
    asOf: '2026-01-01T00:00:00.000Z',
    score: () => 0.7,
  });

  expect(ranked.map((item) => item.id)).toEqual(['active', 'expired']);
  expect(ranked[1].ranking.components.validTime).toBe(0);
});
