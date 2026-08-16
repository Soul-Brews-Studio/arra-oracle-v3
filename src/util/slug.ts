/**
 * The one slug rule in this repo.
 *
 * Every slug site used to carry its own inline copy of `[^a-z0-9\s-]`. That is a rule
 * about the **Latin alphabet**, not a rule about what a filesystem or a URL can hold,
 * and Thai is the primary working language here. The consequences were two, and the
 * quiet one is the worse one:
 *
 *   'ทดสอบไทยล้วนไม่มีอังกฤษ' -> ''          the file became `<date>_.md`
 *   'ทดสอบ fallback ไทยล้วน'  -> 'fallback'  one stray Latin token survived
 *
 * The first is loud: a collision guard (#2819) now appends `-2`, `-3`, … so it no longer
 * throws, but every such learning still shares one meaningless filename. The second
 * looks like success — the file has a plausible name and the title is simply gone.
 *
 * The rule below is about **character class**, not about script: keep letters (\p{L}),
 * numbers (\p{N}) and combining marks (\p{M}) from any script, drop everything else.
 *
 * \p{M} is not optional. Thai tone marks and above/below vowels are nonspacing marks,
 * not letters, so \p{L}\p{N} alone mangles the word rather than preserving it:
 *
 *   'ทดสอบไทยล้วน' with \p{M}    -> 'ทดสอบไทยล้วน'
 *   'ทดสอบไทยล้วน' without \p{M} -> 'ทดสอบไทยลวน'   (the ้ on ล is dropped)
 *
 * ASCII is unaffected, by construction: no ASCII character is in \p{L}\p{N}\p{M} that
 * was not already in `[a-z0-9]` once the input is lower-cased, and none that was
 * excluded becomes included ('_' is \p{Pc}, not \p{M}). `tests/util/slug-ascii-identity.test.ts`
 * proves that exhaustively against the old expressions rather than asserting it here.
 *
 * Salvaged from the idea in PR #2934 (@yimtheppariyapol), re-implemented as one shared
 * rule instead of a fourth private copy of it.
 */

/**
 * Slugs land in filenames, and filesystems budget in **bytes**. ext4 and APFS both cap a
 * name at 255 bytes; Thai costs 3 bytes per character in UTF-8, so the 80-character input
 * window `safeHandoffSlug` uses would have produced a 240-byte slug and a 260-byte
 * `<date>_<time>_<slug>.md` — ENAMETOOLONG, a new failure mode introduced by the fix.
 *
 * 120 bytes is above every call site's character window (50 and 80), so an all-ASCII slug
 * can never reach it and nothing about today's ASCII output changes.
 */
export const SLUG_MAX_BYTES = 120;

/** Title style: punctuation is deleted, whitespace is the separator. `a.b` -> `ab`. */
const NOT_SLUGGABLE_KEEPING_SPACE = /[^\p{L}\p{N}\p{M}\s-]/gu;

/** Snippet style: any run of non-slug characters collapses to one `-`. `a.b` -> `a-b`. */
const NOT_SLUGGABLE = /[^\p{L}\p{N}\p{M}]+/gu;

function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Longest prefix of `value` that fits in `maxBytes` UTF-8 bytes, cut on a code-point
 * boundary. Iterating with `for…of` walks code points, so a surrogate pair is never split
 * into two lone halves.
 */
function clampToBytes(value: string, maxBytes: number): string {
  // A UTF-16 code unit costs at most 3 UTF-8 bytes (a surrogate PAIR is 2 units for 4
  // bytes, i.e. 2 bytes per unit), so below this length the clamp provably cannot fire.
  if (value.length * 3 <= maxBytes) return value;
  let bytes = 0;
  let out = '';
  for (const char of value) {
    const size = utf8Size(char.codePointAt(0)!);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return out;
}

/**
 * A truncation cuts at a code-point boundary and a combining mark always follows its base,
 * so the clamp can drop a mark but can never orphan one — the only tidying it needs is the
 * separator it may expose. Stripping trailing marks unconditionally is WRONG and was the
 * first version of this function: Devanagari `दुनिया` ends in a spacing matra (U+093E, Mc),
 * and removing it spells `दुनिय`.
 */
function tidy(slug: string): string {
  const clamped = clampToBytes(slug, SLUG_MAX_BYTES);
  return clamped === slug ? slug : clamped.replace(/-$/, '');
}

/**
 * `'  Edge: Pattern / Replay  '` -> `'edge-pattern-replay'`.
 *
 * `maxInputChars` truncates the **input**, matching what every call site did before, so
 * where the cut falls relative to word boundaries is unchanged. Returns `''` when nothing
 * survives; each caller supplies its own fallback word, as it always has.
 */
export function slugifyTitle(value: string, maxInputChars: number): string {
  return tidy(
    value
      .substring(0, maxInputChars)
      .toLowerCase()
      .replace(NOT_SLUGGABLE_KEEPING_SPACE, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  );
}

/**
 * `'fix: the parser.  again'` -> `'fix-the-parser-again'`.
 *
 * Differs from `slugifyTitle` in that punctuation *separates* rather than disappearing.
 * `src/trace/learning-files.ts` has always used this shape; keeping the two distinct is
 * deliberate, because collapsing them would change ASCII output.
 */
export function slugifySnippet(value: string, maxInputChars: number): string {
  return tidy(
    value
      .slice(0, maxInputChars)
      .toLowerCase()
      .replace(NOT_SLUGGABLE, '-')
      .replace(/^-|-$/g, ''),
  );
}
