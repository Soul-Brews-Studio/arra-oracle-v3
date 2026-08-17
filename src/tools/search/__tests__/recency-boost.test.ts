/**
 * applyRecencyBoost — same-day records must beat months-old records at equal
 * (or near-equal) relevance, while a clearly better old match still wins.
 *
 * Origin: 2026-08-17 adoption reviews — same-day decision learnings ranked
 * below months-old retros and had to be read by direct id.
 */
import { describe, expect, it } from 'bun:test';
import Database from 'bun:sqlite';
import { applyRecencyBoost } from '../helpers.ts';

const NOW = 1_786_934_000_000; // fixed clock (2026-08-17)
const DAY = 86_400_000;

function makeDb(rows: Array<{ id: string; createdAt: number }>): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)');
  for (const row of rows) {
    sqlite.query('INSERT INTO oracle_documents (id, created_at) VALUES (?, ?)').run(row.id, row.createdAt);
  }
  return sqlite;
}

function result(id: string, score: number) {
  return { id, score };
}

describe('applyRecencyBoost', () => {
  it('breaks a near-tie in favor of the same-day record', () => {
    const sqlite = makeDb([
      { id: 'old-retro', createdAt: NOW - 90 * DAY },
      { id: 'todays-learning', createdAt: NOW - 1 * DAY },
    ]);
    const out = applyRecencyBoost(sqlite, [result('old-retro', 1.08), result('todays-learning', 1.04)], NOW);
    expect(out[0].id).toBe('todays-learning');
    expect(out[0].recencyScore).toBeGreaterThan(0.07);
    expect(out[1].recencyScore ?? 0).toBeLessThan(0.02);
  });

  it('does not let freshness outrank a clearly better old match', () => {
    const sqlite = makeDb([
      { id: 'strong-old', createdAt: NOW - 90 * DAY },
      { id: 'weak-new', createdAt: NOW },
    ]);
    const out = applyRecencyBoost(sqlite, [result('strong-old', 1.1), result('weak-new', 0.6)], NOW);
    expect(out[0].id).toBe('strong-old');
  });

  it('is fail-soft when the documents table is missing', () => {
    const sqlite = new Database(':memory:');
    const input = [result('a', 0.9), result('b', 0.8)];
    const out = applyRecencyBoost(sqlite, input, NOW);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out[0].recencyScore).toBeUndefined();
  });

  it('leaves rows without a created_at date unboosted', () => {
    const sqlite = makeDb([{ id: 'dated', createdAt: NOW }]);
    const out = applyRecencyBoost(sqlite, [result('undated', 0.95), result('dated', 0.9)], NOW);
    const dated = out.find((r) => r.id === 'dated');
    const undated = out.find((r) => r.id === 'undated');
    expect(dated?.recencyScore).toBeGreaterThan(0);
    expect(undated?.recencyScore).toBeUndefined();
  });
});
