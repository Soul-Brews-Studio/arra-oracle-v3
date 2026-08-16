/**
 * Query-side token boundaries must match the FTS index's.
 *
 * The index is built with `tokenize='porter unicode61'` (migration 0017), which treats `_`
 * as a separator. All three query builders extracted tokens with `/[\p{L}\p{N}_]+/gu`,
 * keeping the underscore, and then quoted each token — so `pane_pid` became the phrase
 * query `"pane_pid"`, which FTS5 evaluates as the adjacency phrase `pane pid`.
 *
 * The effect was silent, not an error: `pane_pid` returned 4 rows where `pane OR pid`
 * returned 141 on the same corpus, and one of those 4 contained no literal `pane_pid` at
 * all — it matched adjacent "pane PID". Reported in #2953.
 *
 * The tokenizer is deliberately NOT changed: that would need a fleet-wide reindex and would
 * alter index semantics for everyone. Exact-identifier search, if wanted, belongs in its own
 * field rather than overloading natural-language FTS.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildTenantFtsQuery } from '../query.ts';
import { sanitizeFtsQuery } from '../../tools/search/helpers.ts';
import { buildFtsQuery } from '../../server/handlers.ts';

const BUILDERS: Array<[string, (q: string) => string]> = [
  ['sanitizeFtsQuery', sanitizeFtsQuery],
  ['buildTenantFtsQuery', buildTenantFtsQuery],
  ['buildFtsQuery', buildFtsQuery],
];

describe('FTS query builders split on underscore, as the index does', () => {
  for (const [name, build] of BUILDERS) {
    test(`${name} splits pane_pid into separate OR terms`, () => {
      const out = build('pane_pid');
      expect(out).toContain('"pane"');
      expect(out).toContain('"pid"');
      expect(out).toContain('OR');
      // The regression: one quoted token containing the underscore.
      expect(out).not.toContain('"pane_pid"');
    });

    test(`${name} treats . and - the same way`, () => {
      for (const input of ['pane.pid', 'pane-pid']) {
        const out = build(input);
        expect(out).toContain('"pane"');
        expect(out).toContain('"pid"');
      }
    });

    test(`${name} still handles non-Latin input`, () => {
      const out = build('ทดสอบ_ไทย');
      expect(out).toContain('"ทดสอบ"');
      expect(out).toContain('"ไทย"');
    });

    test(`${name} collapses repeated separators without emitting empty tokens`, () => {
      const out = build('pane___pid');
      expect(out).not.toContain('""');
      expect(out).toContain('"pane"');
      expect(out).toContain('"pid"');
    });
  }

  test('against a real FTS5 index, OR recall beats the old phrase behaviour', () => {
    // The proof that this is a recall bug and not a formatting preference: run both query
    // shapes against a real index with the production tokenizer.
    const db = new Database(':memory:');
    db.run("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='porter unicode61')");
    db.run("INSERT INTO t(body) VALUES ('the pane_pid value')");
    db.run("INSERT INTO t(body) VALUES ('a pane holds a pid')");
    db.run("INSERT INTO t(body) VALUES ('pid alone')");

    const count = (match: string) =>
      (db.query(`SELECT COUNT(*) c FROM t WHERE t MATCH ?`).get(match) as { c: number }).c;

    const oldPhrase = count('"pane_pid"');
    const fixed = count(buildFtsQuery('pane_pid'));

    expect(fixed).toBeGreaterThan(oldPhrase);
    db.close();
  });
});
