/**
 * The one tokenizer the consolidation workers share (#2912).
 *
 * There were **six**, and no two agreed:
 *
 *   consolidation.ts          NFKC, length > 2, 10 stopwords
 *   memory-consolidation.ts   NFKC, length > 2,  8 stopwords
 *   fact-curation.ts          NFKC, length > 2, 12 stopwords
 *   consolidation-llm.ts      NFKC, length > 2, 12 stopwords
 *   sleep-consolidation.ts    no NFKC, no length floor, no stopwords
 *   sleep-consolidation-llm.ts  same as above
 *
 * The same similarity threshold therefore meant six different things depending on which worker
 * read it. That is a trap rather than a live bug — see below — but it is the kind that springs
 * the moment someone tunes a threshold.
 *
 * ## Why unifying is safe, measured rather than assumed
 *
 * At the shipped `minCosine 0.96 / minOverlap 0.9`, the stopword list makes no difference at
 * all. On 700 general documents the three sets produced **28 candidate pairs each, with zero
 * set difference**; on 900 Thai-containing documents, **117 each — and 117 again with no
 * stopwords whatsoever**.
 *
 * The thresholds are why: at 0.96/0.9 only near-duplicates qualify, and a near-duplicate shares
 * essentially every token whether or not four function words are filtered.
 *
 * **That neutrality is a property of 0.96/0.9, not of this function.** Lower the thresholds to
 * catch near-misses instead of near-duplicates and stopwords begin to matter — which is exactly
 * why one definition is better than six.
 *
 * The character class was settled separately in #2914: `[\p{L}\p{N}_:-]` matches identical runs
 * to the old `[a-z0-9_:-]` for ASCII input, so it is a no-op except for the non-ASCII text that
 * used to tokenize to nothing.
 */

/** Superset of every list that existed, from `fact-curation.ts`. */
export const CONSOLIDATION_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'use', 'uses',
]);

/** Tokens shorter than this carry no signal and inflate overlap. */
export const MIN_TOKEN_LENGTH = 3;

/**
 * Split text into comparable tokens.
 *
 * `_`, `:` and `-` stay *inside* tokens deliberately — `snake_case`, `ns:qualified` and
 * `kebab-case` are single identifiers in this corpus, and splitting them would make unrelated
 * documents look alike.
 */
export function tokenizeForConsolidation(text: string): string[] {
  return (String(text ?? '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}_:-]+/gu) ?? [])
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !CONSOLIDATION_STOPWORDS.has(token));
}

/** Set form, for the overlap comparisons. */
export function tokenSetForConsolidation(text: string): Set<string> {
  return new Set(tokenizeForConsolidation(text));
}
