import { describe, expect, test } from 'bun:test';
import { chunkDocumentForIndexing, chunkText, chunk_text } from '../chunker.ts';
import type { OracleDocument } from '../../types.ts';

function doc(content: string): OracleDocument {
  return {
    id: 'learning-note',
    type: 'learning',
    source_file: 'ψ/memory/learnings/note.md',
    content,
    concepts: ['chunking'],
    created_at: 1,
    updated_at: 1,
  };
}

describe('paragraph-aware chunk_text', () => {
  test('packs whole paragraphs and records source line spans', () => {
    const text = [
      'first paragraph line 1',
      'first paragraph line 2',
      '',
      'second paragraph',
      '',
      'third paragraph',
    ].join('\n');

    const chunks = chunkText(text, 65);

    expect(chunk_text).toBe(chunkText);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.content.length <= 65)).toBe(true);
    expect(chunks[0]).toMatchObject({ chunk_index: 0, line_start: 1, line_end: 4 });
    expect(chunks[0].content).toContain('second paragraph');
    expect(chunks[1]).toMatchObject({ chunk_index: 1, line_start: 6, line_end: 6 });
    expect(chunks[1].content).toBe('third paragraph');
  });

  test('hard-splits an overlong line while keeping line metadata', () => {
    const chunks = chunkText('abcdefghij', 4);

    expect(chunks.map((chunk) => chunk.content)).toEqual(['abcd', 'efgh', 'ij']);
    expect(chunks.map((chunk) => [chunk.line_start, chunk.line_end])).toEqual([[1, 1], [1, 1], [1, 1]]);
  });

  test('adds deterministic chunk ids only when a document needs multiple chunks', () => {
    const first = `alpha ${'a'.repeat(30)}`;
    const second = `beta ${'b'.repeat(30)}`;
    const third = `gamma ${'c'.repeat(30)}`;
    const chunks = chunkDocumentForIndexing(doc(`${first}\n\n${second}\n\n${third}`), 80);

    expect(chunks.map((chunk) => chunk.id)).toEqual(['learning-note__chunk_0', 'learning-note__chunk_1']);
    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([0, 1]);
    expect(chunks[0].content).toContain(second);
    expect(chunks[1]).toMatchObject({ line_start: 5, line_end: 5 });
  });

  test('preserves a short document id and exact content', () => {
    const content = 'short\r\ncontent\n';
    const [chunk] = chunkDocumentForIndexing(doc(content));

    expect(chunk.id).toBe('learning-note');
    expect(chunk.content).toBe(content);
    expect(chunk).toMatchObject({ chunk_index: 0, line_start: 1, line_end: 2 });
  });
});
