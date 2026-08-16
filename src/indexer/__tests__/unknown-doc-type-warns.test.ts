/**
 * An unrecognised document type must be loud.
 *
 * `parseFrontmatterDocType` falls back to a default when it does not recognise a type, and
 * `src/indexer/storage.ts` then writes that fallback over the row. So a document type that is not
 * in `ORACLE_DOC_TYPES` appears to work when written and is **demoted on the next reindex** — no
 * error, no failed test, just a type that quietly reverts. The document survives; only its
 * classification is lost, which is the hardest kind of loss to notice.
 *
 * The distinction that makes the warning correct: declaring NO type is ordinary and must stay
 * silent; declaring an UNKNOWN type is a mistake and must not.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parseFrontmatterDocType } from '../frontmatter.ts';

const doc = (type?: string) => `---\n${type ? `type: ${type}\n` : ''}title: A document\n---\n\nbody\n`;

let warnings: string[] = [];
const realWarn = console.warn;

beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
});

afterEach(() => {
  console.warn = realWarn;
});

describe('parseFrontmatterDocType', () => {
  test('a known type is returned unchanged, silently', () => {
    expect(parseFrontmatterDocType(doc('retro'), ['type'], 'learning')).toBe('retro');
    expect(parseFrontmatterDocType(doc('principle'), ['type'], 'learning')).toBe('principle');
    expect(warnings).toEqual([]);
  });

  test('no declared type falls back silently — this is the ordinary case', () => {
    expect(parseFrontmatterDocType(doc(), ['type'], 'learning')).toBe('learning');
    expect(warnings).toEqual([]);
  });

  test('an UNKNOWN declared type still falls back, but says so', () => {
    // e.g. someone adds a `lesson` type to the writer and forgets ORACLE_DOC_TYPES
    const result = parseFrontmatterDocType(doc('lesson'), ['type'], 'learning');
    expect(result).toBe('learning');                       // behaviour unchanged — still safe
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('lesson');
    expect(warnings[0]).toContain('ORACLE_DOC_TYPES');     // names the file to edit
    expect(warnings[0]).toContain('reindex');              // names the consequence
  });

  test('warns once per unknown type, not once per document', () => {
    for (let i = 0; i < 5; i++) parseFrontmatterDocType(doc('lesson'), ['type'], 'learning');
    // a corpus with thousands of such documents must not produce thousands of lines
    expect(warnings.filter((w) => w.includes('lesson')).length).toBeLessThanOrEqual(1);
  });

  test('a different unknown type gets its own warning', () => {
    parseFrontmatterDocType(doc('bible'), ['type'], 'learning');
    expect(warnings.some((w) => w.includes('bible'))).toBe(true);
  });
});
