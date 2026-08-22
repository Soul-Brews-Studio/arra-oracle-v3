import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { normalizeRank, buildFtsMatchQuery } from '../fts-rank.ts';
import { buildFtsQuery } from '../../server/handlers.ts';
import { buildTenantFtsQuery } from '../query.ts';
import { combineResults } from '../fusion.ts';

describe('buildFtsMatchQuery — whole-query phrase clause (opaque-token fix)', () => {
  test('≥2 tokens: prepends a contiguous phrase clause before the OR fragments', () => {
    expect(buildFtsMatchQuery('PANE-PID')).toBe('"PANE PID" OR "PANE" OR "PID"');
    // both HTTP and tenant builders delegate to the shared builder:
    expect(buildFtsQuery('PANE-PID')).toBe('"PANE PID" OR "PANE" OR "PID"');
    expect(buildTenantFtsQuery('PANE-PID')).toBe('"PANE PID" OR "PANE" OR "PID"');
  });

  test('single token: no phrase clause; empty/punctuation-only: empty string', () => {
    expect(buildFtsMatchQuery('pane')).toBe('"pane"');
    expect(buildFtsMatchQuery('   ---   ')).toBe('');
  });
});

describe('ACCEPTANCE — phrase clause lifts an opaque marker over fragment-heavy noise (real FTS5)', () => {
  function seed(): Database {
    const db = new Database(':memory:');
    db.run("CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61')");
    // marker: the opaque token as a contiguous phrase, SHORT. noise docs repeat a
    // single fragment heavily so they win the fragment-OR on the fused score.
    const docs: Array<[string, string]> = [
      ['marker', 'pane pid mapping note'],
      ['both-loose', 'a pane here and a pid there, discussed pane and pid separately many pane times pid'],
      ['spam-pane', 'pane pane pane pane pane pane pane pane pane pane layout resize split focus rotate'],
      ['spam-pid', 'pid pid pid pid pid pid pid pid process id table registry lookup handle'],
    ];
    for (const [id, content] of docs) db.run('INSERT INTO oracle_fts(id,content,concepts) VALUES(?,?,?)', [id, content, '']);
    return db;
  }

  function rankMarker(db: Database, ftsQuery: string): number {
    const rows = db.query('SELECT f.id AS id, rank AS score FROM oracle_fts f WHERE oracle_fts MATCH ? ORDER BY rank LIMIT 20').all(ftsQuery) as Array<{ id: string; score: number }>;
    const ftsResults = rows.map((r) => ({ id: r.id, type: 'x', content: '', source_file: '', concepts: [], source: 'fts' as const, score: normalizeRank(r.score) }));
    return combineResults(ftsResults, []).findIndex((r) => r.id === 'marker') + 1;
  }

  test('the fragment-OR buries the marker; the whole-query phrase clause lifts it to #1', () => {
    const db = seed();
    const plainOR = '"PANE" OR "PID"';                 // the pre-fix builder output
    const withPhrase = buildFtsQuery('PANE-PID');       // now: "PANE PID" OR "PANE" OR "PID"
    const plainRank = rankMarker(db, plainOR);
    const phraseRank = rankMarker(db, withPhrase);
    expect(plainRank).toBeGreaterThan(1);   // a fragment-heavy doc outranks the marker under plain OR
    expect(phraseRank).toBe(1);             // phrase clause makes the exact-adjacency marker win
    expect(phraseRank).toBeLessThan(plainRank);
    db.close();
  });
});
