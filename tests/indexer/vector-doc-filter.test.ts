import { describe, expect, test } from 'bun:test';
import { filterVectorDocs, isLearnOrigin } from '../../src/indexer/vector-doc-filter.ts';
import type { VectorDocument } from '../../src/vector/types.ts';

const doc = (id: string, document: string, source_file = 'ψ/memory/x.md'): VectorDocument =>
  ({ id, document, metadata: { source_file } });
const long = 'x'.repeat(60);

describe('filterVectorDocs', () => {
  test('drops ψ/learn/**/origin copies and texts under 40 chars, counts each', () => {
    const res = filterVectorDocs([
      doc('keep', long),
      doc('short', '  [host:agent] ping  '),
      doc('origin', long, 'github.com/acme/notes-oracle/ψ/learn/owner/repo/origin/data/FULL_TEXT.md'),
      doc('learn-note', long, 'github.com/acme/x/ψ/learn/owner/repo/2026-11-21_notes.md'),
    ]);
    expect(res.kept.map((d) => d.id)).toEqual(['keep', 'learn-note']);
    expect(res.tooShort).toBe(1);
    expect(res.learnOrigin).toBe(1);
  });

  test('options keep everything', () => {
    const docs = [doc('s', 'hi'), doc('o', long, 'ψ/learn/a/b/origin/c.md')];
    expect(filterVectorDocs(docs, { minChars: 0, keepLearnOrigin: true }).kept).toHaveLength(2);
  });

  test('origin only counts under ψ/learn', () => {
    expect(isLearnOrigin('src/origin/file.md')).toBe(false);
    expect(isLearnOrigin('ψ/learn/a/b/origin/c.md')).toBe(true);
    expect(isLearnOrigin(undefined)).toBe(false);
  });
});
