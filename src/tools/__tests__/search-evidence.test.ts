import { expect, test } from 'bun:test';
import { attachSearchEvidence, confidenceForResult, provenanceForResult } from '../search.ts';
import type { CombinedSearchResult } from '../search/types.ts';

const baseResult = {
  id: 'memory-doc',
  type: 'learning',
  content: 'Memory systems need evidence and confidence.',
  source_file: 'ψ/memory/morning-tape.md',
  concepts: ['memory'],
} satisfies Partial<CombinedSearchResult>;

test('confidence ranks hybrid results above weak single-source matches', () => {
  const hybrid = confidenceForResult({
    ...baseResult,
    score: 0.72,
    source: 'hybrid',
    ftsScore: 0.8,
    vectorScore: 0.74,
  } as CombinedSearchResult);
  const fts = confidenceForResult({
    ...baseResult,
    score: 0.38,
    source: 'fts',
  } as CombinedSearchResult);

  expect(hybrid.level).toBe('high');
  expect(hybrid.signals).toContain('matched by FTS and vector search');
  expect(fts.level).toBe('low');
  expect(fts.signals).toEqual(['matched by keyword search']);
});

test('provenance surfaces source file and vector lineage', () => {
  const provenance = provenanceForResult({
    ...baseResult,
    score: 0.91,
    source: 'vector',
    vectorScore: 0.91234,
    distance: 0.08765,
    model: 'bge-m3',
  } as CombinedSearchResult);

  expect(provenance).toEqual({
    source: 'vector',
    source_file: 'ψ/memory/morning-tape.md',
    vector_score: 0.912,
    vector_distance: 0.088,
    vector_model: 'bge-m3',
  });
});

test('attachSearchEvidence decorates oracle_search results inline', () => {
  const [result] = attachSearchEvidence([{
    ...baseResult,
    score: 0.51,
    source: 'fts',
    ftsScore: 0.51,
  } as CombinedSearchResult]);

  expect(result.confidence).toMatchObject({ level: 'medium', score: 0.51 });
  expect(result.provenance).toMatchObject({ source: 'fts', fts_score: 0.51 });
});
