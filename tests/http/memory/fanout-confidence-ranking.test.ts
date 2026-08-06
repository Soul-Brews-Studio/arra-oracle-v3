import { expect, test } from 'bun:test';
import { fanoutEntitySignalConfig, fuseRankedResults } from '../../../src/routes/memory/fanout.ts';
import type { SearchResult } from '../../../src/server/types.ts';

type FanoutHit = SearchResult & {
  title?: string;
  tags?: string[];
  memorySource?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
  lastAccessedAt?: string;
};

const NOW = new Date('2026-06-17T00:00:00.000Z');
const RRF_K = 60;

function hit(id: string, score: number, extra: Partial<FanoutHit> = {}): FanoutHit {
  return {
    id,
    type: 'memory',
    content: `${id} confidence ranking fixture`,
    source_file: extra.source_file ?? '',
    concepts: extra.concepts ?? [],
    source: 'vector',
    score,
    createdAt: extra.createdAt ?? NOW.toISOString(),
    updatedAt: extra.updatedAt ?? extra.createdAt ?? NOW.toISOString(),
    ...extra,
  };
}

function confidenceReorderFixture(): Record<string, FanoutHit[]> {
  return {
    alpha: [
      hit('stale-vector-win', 1, {
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
      hit('trusted-fresh', 0.91, {
        title: 'Trusted fresh deploy note',
        tags: ['deploy', 'confidence'],
        concepts: ['deploy'],
        memorySource: 'session://codex-2684',
        source_file: 'trusted.md',
      }),
    ],
  };
}

function usageTieFixture(): Record<string, FanoutHit[]> {
  const common = {
    title: 'Same provenanced note',
    tags: ['reinforcement'],
    memorySource: 'session://same',
    source_file: 'same.md',
  };
  return {
    alpha: [
      hit('unused', 0.9, common),
      hit('reinforced', 0.9, { ...common, usageCount: 20, lastAccessedAt: NOW.toISOString() }),
    ],
    beta: [
      hit('reinforced', 0.9, { ...common, usageCount: 20, lastAccessedAt: NOW.toISOString() }),
      hit('unused', 0.9, common),
    ],
  };
}

function pureRrfExpected(byCollection: Record<string, SearchResult[]>) {
  const scores = new Map<string, { raw: number; bestScore: number }>();
  for (const results of Object.values(byCollection)) {
    results.forEach((result, index) => {
      const current = scores.get(result.id) ?? { raw: 0, bestScore: result.score ?? 0 };
      current.raw += 1 / (RRF_K + index + 1);
      current.bestScore = Math.max(current.bestScore, result.score ?? 0);
      scores.set(result.id, current);
    });
  }
  const maxRaw = Math.max(...[...scores.values()].map((item) => item.raw));
  return [...scores.entries()]
    .map(([id, item]) => ({
      id,
      fusedScore: round6(item.raw),
      rankingScore: round6(item.raw / maxRaw),
      bestScore: item.bestScore,
    }))
    .sort((a, b) => b.rankingScore - a.rankingScore || b.fusedScore - a.fusedScore || b.bestScore - a.bestScore)
    .map(({ id, fusedScore, rankingScore }) => ({ id, fusedScore, rankingScore }));
}

function round6(value: number): number {
  return +value.toFixed(6);
}

test('confidenceWeight promotes a fresher provenanced hit over pure vector rank', () => {
  const fixture = confidenceReorderFixture();
  const pure = fuseRankedResults(fixture, 2, { confidenceWeight: 0, now: NOW });
  const weighted = fuseRankedResults(fixture, 2, { confidenceWeight: 0.25, now: NOW });

  expect(pure.map((item) => item.id)).toEqual(['stale-vector-win', 'trusted-fresh']);
  expect(weighted.map((item) => item.id)).toEqual(['trusted-fresh', 'stale-vector-win']);
  expect(weighted[0].confidence.score).toBeGreaterThan(weighted[1].confidence.score);
  expect(weighted[0].rankingScore).toBeGreaterThan(weighted[1].rankingScore);
});

test('confidenceWeight zero reproduces exact pure RRF scores and ordering', () => {
  const fixture: Record<string, FanoutHit[]> = {
    alpha: [
      hit('fresh-trusted', 0.86, { tags: ['rank'], memorySource: 'runbook', title: 'Fresh trusted' }),
      hit('stale-vector', 0.99, { createdAt: '2020-01-01T00:00:00.000Z' }),
      hit('shared', 0.75, { tags: ['shared'] }),
    ],
    beta: [
      hit('shared', 0.97, { tags: ['shared'] }),
      hit('beta-only', 0.95),
      hit('stale-vector', 0.6, { createdAt: '2020-01-01T00:00:00.000Z' }),
      hit('fresh-trusted', 0.7, { tags: ['rank'], memorySource: 'runbook', title: 'Fresh trusted' }),
    ],
    gamma: [hit('gamma-only', 0.88)],
  };

  const fused = fuseRankedResults(fixture, 5, { confidenceWeight: 0, now: NOW })
    .map(({ id, fusedScore, rankingScore }) => ({ id, fusedScore, rankingScore }));

  expect(fused).toEqual(pureRrfExpected(fixture));
  expect(fused.map((item) => item.id)).toEqual([
    'shared',
    'fresh-trusted',
    'stale-vector',
    'gamma-only',
    'beta-only',
  ]);
});

test('entity signal is carved from confidence budget and disabled at zero weight', () => {
  const fixture: Record<string, FanoutHit[]> = {
    alpha: [hit('plain-vector-win', 1), hit('linked-entity', 0.9)],
  };
  const entitySignals = new Map([['linked-entity', { score: 1, matches: ['OracleNet'] }]]);
  const pure = fuseRankedResults(fixture, 2, { confidenceWeight: 0, entitySignals, now: NOW });
  const weighted = fuseRankedResults(fixture, 2, { confidenceWeight: 0.25, entitySignals, now: NOW });

  expect(fanoutEntitySignalConfig(0)).toMatchObject({ enabled: false, weight: 0, graph: false });
  expect(fanoutEntitySignalConfig(0.25)).toMatchObject({ enabled: true, weight: 0.06, source: 'oracle_entity_links' });
  expect(pure.map(({ id, fusedScore, rankingScore }) => ({ id, fusedScore, rankingScore })))
    .toEqual(pureRrfExpected(fixture));
  expect(weighted.map((item) => item.id)).toEqual(['linked-entity', 'plain-vector-win']);
  expect(weighted[0]).toMatchObject({ entity_score: 1, entity_matches: ['OracleNet'] });
});

test('usage confidence term reorders otherwise equal fused results', () => {
  const fixture = usageTieFixture();
  const weighted = fuseRankedResults(fixture, 2, { confidenceWeight: 0.25, usageWeight: 0.1, now: NOW });
  const disabled = fuseRankedResults(fixture, 2, { confidenceWeight: 0.25, usageWeight: 0, now: NOW });

  expect(weighted.map((item) => item.id)).toEqual(['reinforced', 'unused']);
  expect(weighted[0].confidence.components.usage).toBeGreaterThan(weighted[1].confidence.components.usage);
  expect(disabled.map((item) => item.id)).toEqual(['unused', 'reinforced']);
  expect(disabled[0].confidence.score).toBe(disabled[1].confidence.score);
});
