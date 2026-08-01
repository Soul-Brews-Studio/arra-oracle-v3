/**
 * Acronym expansions must not merge into one entity (#2876).
 *
 * `augmentQueryWithAcronyms` appended expansions as bare space-joined text, so two adjacent
 * ones merged under entity extraction into a phrase that matches nothing:
 *
 *   "what does the API and db do"
 *     → "… Application Programming Interface Database"
 *     → entities: ["API", "Application Programming Interface Database"]
 *
 * Neither `application-programming-interface` nor `database` survived as a key, so entity-link
 * boosting was silently skipped — results still returned, ranked by FTS alone, looking entirely
 * normal. Same shape as #2857 and #2863: a stage does nothing while the pipeline reports
 * success.
 *
 * #2876 deferred the fix because the augmented string also feeds FTS, and changing its shape
 * would change retrieval for every query. **It turns out the FTS path never sees the
 * separator**: both `buildTenantFtsQuery` and `src/tools/search/helpers.ts` tokenise with
 * `/[\p{L}\p{N}]+/gu`, which takes only letters and digits. The third describe
 * block below is the one that made this shippable — it pins that invariance rather than
 * assuming it.
 */
import { describe, expect, test } from 'bun:test';
import { augmentQueryWithAcronyms } from '../../src/search/acronyms.ts';
import { buildTenantFtsQuery } from '../../src/search/query.ts';
import { extractEntities } from '../../src/vector/entities.ts';
import { noteEntityBoostOutcome, rankingSignalCounters, resetSignalHealth } from '../../src/search/signal-health.ts';

const TWO_ACRONYMS = 'what does the API and db do';

describe('expansions stay separate entities', () => {
  test('a two-acronym query yields both expansions as distinct entities', () => {
    const entities = extractEntities(augmentQueryWithAcronyms(TWO_ACRONYMS));
    expect(entities).toContain('Application Programming Interface');
    expect(entities).toContain('Database');
  });

  test('the merged phrase is gone', () => {
    // This exact string was the bug: not a thing, matched nothing, and displaced two real keys.
    expect(extractEntities(augmentQueryWithAcronyms(TWO_ACRONYMS)))
      .not.toContain('Application Programming Interface Database');
  });

  test('a single acronym does not merge with its own expansion', () => {
    // "API" used to extract as the single entity "API Application Programming Interface".
    const entities = extractEntities(augmentQueryWithAcronyms('API'));
    expect(entities).toContain('Application Programming Interface');
    expect(entities).not.toContain('API Application Programming Interface');
  });

  test('order does not matter — "db API" behaves like "API db"', () => {
    // The issue's table showed the two orderings failing differently, which is its own tell.
    for (const query of ['API db', 'db API']) {
      const entities = extractEntities(augmentQueryWithAcronyms(query));
      expect(entities).toContain('Application Programming Interface');
      expect(entities).toContain('Database');
    }
  });
});

describe('a query with no acronyms is untouched', () => {
  test('no separator is appended when there is nothing to append', () => {
    const plain = 'deployment plan for the cluster';
    expect(augmentQueryWithAcronyms(plain)).toBe(plain);
  });
});

describe('retrieval is unchanged — the reason #2876 deferred this', () => {
  /**
   * The FTS query is built from `/[\p{L}\p{N}]+/gu` matches, so punctuation cannot appear in
   * it. These tests compare against a locally reconstructed "old format" (bare space-joined)
   * to show the token sets are identical, rather than asserting a hard-coded string that would
   * pass for the wrong reason if the tokeniser changed.
   */
  function ftsTokens(query: string): string[] {
    return buildTenantFtsQuery(query).split(' OR ').map((t) => t.replace(/^"|"$/g, ''));
  }

  /** What the tokeniser would produce from the pre-fix, bare-joined augmented string. */
  function tokensOfOldFormat(augmented: string): string[] {
    const bare = augmented.replaceAll('; ', ' ');
    const matched = bare.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
    return [...new Set(matched)];
  }

  for (const query of [TWO_ACRONYMS, 'API', 'API db', 'db API', 'deployment plan']) {
    test(`"${query}" produces the same FTS tokens as the old format`, () => {
      expect(ftsTokens(query)).toEqual(tokensOfOldFormat(augmentQueryWithAcronyms(query)));
    });
  }

  test('the separator never reaches the FTS query', () => {
    expect(buildTenantFtsQuery(TWO_ACRONYMS)).not.toContain(';');
  });
});

describe('the entity boost records whether it applied (#2876 criterion 4)', () => {
  /**
   * A *warning* would be wrong: a query matching no linked entity is ordinary, so warning per
   * query would cry wolf on the search hot path. What was missing is any way to answer "is this
   * boost ever applying?" — #2876 had it skipped for every two-acronym query, and #2878 shipped
   * a fix that was a no-op in production. Both were invisible for the same reason.
   */
  test('a skipped boost increments the skipped counter', () => {
    resetSignalHealth();
    const before = rankingSignalCounters().entityBoost;
    noteEntityBoostOutcome(false);
    expect(rankingSignalCounters().entityBoost.skipped).toBe(before.skipped + 1);
    expect(rankingSignalCounters().entityBoost.applied).toBe(before.applied);
  });

  test('an applied boost increments the applied counter', () => {
    resetSignalHealth();
    noteEntityBoostOutcome(true);
    expect(rankingSignalCounters().entityBoost).toEqual({ applied: 1, skipped: 0 });
  });

  test('the snapshot is a copy, not a live reference', () => {
    // Handing out the mutable object would let a caller corrupt the counters by accident.
    resetSignalHealth();
    const snapshot = rankingSignalCounters();
    noteEntityBoostOutcome(true);
    expect(snapshot.entityBoost.applied).toBe(0);
  });
});
