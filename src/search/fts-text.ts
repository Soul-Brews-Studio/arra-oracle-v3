const thaiWords = new Intl.Segmenter('th', { granularity: 'word' });
const thaiRun = /\p{Script=Thai}+/gu;
const wordCharacter = /[\p{L}\p{N}\p{M}]/u;

/** Only Thai runs change; preserve punctuation, whitespace and combining marks. */
export function segmentThaiText(text: string): string {
  return text.replace(thaiRun, (run, offset: number) => {
    const words = Array.from(thaiWords.segment(run), ({ segment }) => segment).join(' ');
    const before = offset > 0 && wordCharacter.test(text[offset - 1]) ? ' ' : '';
    const end = offset + run.length;
    const after = end < text.length && wordCharacter.test(text[end]) ? ' ' : '';
    return before + words + after;
  });
}

/** Quoted Thai runs are phrases, including fragments produced by unicode61 at marks. */
export function ftsQueryTerms(query: string): string[] {
  const clean = query.replace(/<[^>]*>/g, ' ')
    // NFKC decomposes Thai SARA AM; the index keeps its original spelling.
    .replace(/[^\p{Script=Thai}]+/gu, (run) => run.normalize('NFKC'));
  const terms = clean.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  return terms.flatMap((term) => term.match(/\p{Script=Thai}+|[^\p{Script=Thai}]+/gu) ?? [])
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    .map((term) => `"${segmentThaiText(term)}"`);
}
