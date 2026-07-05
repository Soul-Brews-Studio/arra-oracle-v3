import { describe, expect, test } from 'bun:test';
import { chunkDocumentForIndexing, chunkText } from '../../../src/indexer/chunk-text.ts';
import type { OracleDocument } from '../../../src/types.ts';

function doc(content: string): OracleDocument {
  return {
    id: 'onboarding-note',
    type: 'learning',
    source_file: 'mine/sample/onboarding.md',
    content,
    concepts: ['onboarding'],
    created_at: 1,
    updated_at: 2,
  };
}

describe('P0 onboarding chunker', () => {
  test('splits long notes on paragraph boundaries before crossing the max size', () => {
    const first = `alpha ${'a'.repeat(28)}`;
    const second = `beta ${'b'.repeat(28)}`;
    const third = `gamma ${'c'.repeat(28)}`;
    const text = `${first}\n\n${second}\n\n${third}`;

    const chunks = chunkText(text, 80);

    expect(chunks).toEqual([
      { content: `${first}\n\n${second}`, chunk_index: 0, line_start: 1, line_end: 3 },
      { content: third, chunk_index: 1, line_start: 5, line_end: 5 },
    ]);
    expect(chunks[0].content).not.toContain(third);
  });

  test('adds stable chunk ids and line ranges for indexed documents', () => {
    const chunks = chunkDocumentForIndexing(doc('first paragraph\n\nsecond paragraph\n\nthird paragraph'), 34);

    expect(chunks.map((chunk) => chunk.id)).toEqual(['onboarding-note__chunk_0', 'onboarding-note__chunk_1']);
    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([0, 1]);
    expect(chunks[0]).toMatchObject({ line_start: 1, line_end: 3 });
    expect(chunks[1]).toMatchObject({ content: 'third paragraph', line_start: 5, line_end: 5 });
  });
});
