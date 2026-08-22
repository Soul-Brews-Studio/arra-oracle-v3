import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { normalizeRank } from '../fts-rank.ts';
import { normalizeFtsScore } from '../../tools/search/helpers.ts';
import { buildFtsQuery } from '../../server/handlers.ts';
import { combineResults } from '../fusion.ts';

// The old, inverted HTTP normalizer — kept here only as a regression oracle so
// the acceptance test can prove the fix flips the ranking.
const oldInvertedRank = (rank: number) => Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));

describe('normalizeRank — de-inversion + HTTP/local parity', () => {
  test('monotonic increasing: a stronger bm25 match (more negative) scores higher', () => {
    expect(normalizeRank(-10)).toBeGreaterThan(normalizeRank(-1));
    expect(normalizeRank(-1)).toBeGreaterThan(normalizeRank(-0.1));
  });

  test('de-inverted: a strong match is near the ceiling, not the floor (the S1 bug)', () => {
    expect(normalizeRank(-50)).toBeGreaterThan(0.94);
    // The OLD HTTP formula did the opposite — the strongest match got the lowest score:
    expect(oldInvertedRank(-50)).toBeLessThan(oldInvertedRank(-0.5));
    expect(normalizeRank(-50)).toBeGreaterThan(normalizeRank(-0.5));
  });

  test('HTTP/local parity: normalizeFtsScore is the same function as normalizeRank', () => {
    for (const r of [-100, -10, -1, -0.5, 0]) {
      expect(normalizeFtsScore(r)).toBe(normalizeRank(r));
    }
    expect(normalizeRank(NaN)).toBe(0);
  });
});

describe('ACCEPTANCE — opaque marker ranks 1-2 over fragment-noise (real FTS5)', () => {
  function seed(): Database {
    const db = new Database(':memory:');
    db.run("CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61')");
    const docs: Array<[string, string]> = [
      ['marker', 'BARB-PAIR-6ACA3E paired repro probe seeded marker for the drill'],
      ['noise-barb-1', 'the barb on the fence was sharp; another barb needed a barb repair'],
      ['noise-barb-2', 'barb wire barb fencing barb installation notes and a barb guide'],
      ['noise-pair-1', 'a pair of shoes and another pair of socks make a matching pair'],
      ['noise-pair-2', 'pair programming pair review pair rotation and pair swap cadence'],
      ['noise-both', 'the barb and the pair were discussed as a barb pair topic once'],
    ];
    for (const [id, content] of docs) {
      db.run('INSERT INTO oracle_fts(id,content,concepts) VALUES(?,?,?)', [id, content, '']);
    }
    return db;
  }

  // Real end-to-end HTTP fts leg: buildFtsQuery (unchanged, plain-OR) → MATCH →
  // ORDER BY rank → normalizeRank → fusion sort. Returns the marker's 1-indexed
  // rank (0 = absent).
  function rankMarker(db: Database, scoreFn: (rank: number) => number): number {
    const ftsQuery = buildFtsQuery('BARB-PAIR-6ACA3E');
    const rows = db.query('SELECT f.id AS id, rank AS score FROM oracle_fts f WHERE oracle_fts MATCH ? ORDER BY rank LIMIT 20').all(ftsQuery) as Array<{ id: string; score: number }>;
    const ftsResults = rows.map((r) => ({ id: r.id, type: 'retro', content: '', source_file: '', concepts: [], source: 'fts' as const, score: scoreFn(r.score) }));
    return combineResults(ftsResults, []).findIndex((r) => r.id === 'marker') + 1;
  }

  test('the exact opaque marker ranks 1-2 with the fixed normalizer, and beats the old inverted one', () => {
    const db = seed();
    const fixedRank = rankMarker(db, normalizeRank);
    const oldRank = rankMarker(db, oldInvertedRank);
    expect(fixedRank).toBeGreaterThan(0);        // present
    expect(fixedRank).toBeLessThanOrEqual(2);    // acceptance: opaque marker rank 1-2
    expect(fixedRank).toBeLessThan(oldRank);     // the inversion buried it (last); the fix lifts it to #1
    db.close();
  });
});
