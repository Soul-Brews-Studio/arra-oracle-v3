/**
 * Filename slug derivation for vault documents (learnings, handoffs).
 *
 * Kept in one place because the same six-line chain was copy-pasted across the MCP tools and
 * the HTTP routes, so a bug in it had to be fixed four times to actually be fixed.
 */

/**
 * Build a filename slug from a free-text title.
 *
 * Keeps any Unicode letter, number, or combining mark — not just `[a-z0-9]`. The previous rule
 * stripped every non-ASCII character, so a title written entirely in a non-Latin script (Thai,
 * Japanese, Cyrillic, ...) collapsed to an empty slug. The first such document of the day then
 * took the id `<prefix>_<date>_` and every later one that day was rejected with
 * `UNIQUE constraint failed: oracle_documents.id`. A single Latin letter or digit anywhere in
 * the title masked the bug, which is why it went unnoticed.
 *
 * `\p{M}` matters as much as `\p{L}`: without it, Thai vowel signs and tone marks are stripped,
 * so "ทดสอบไทยล้วน" silently becomes "ทดสอบไทยลวน" — a different word.
 *
 * Falls back to a short content hash when a title has no letters or numbers at all (punctuation
 * or emoji only), so the slug is never empty and the id stays unique.
 */
export function slugifyPattern(pattern: string): string {
  const slug = pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug) return slug;
  let h = 0;
  for (const ch of pattern) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
  return `x${(h >>> 0).toString(36)}`;
}
