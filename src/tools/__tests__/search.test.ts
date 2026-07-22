/**
 * Unit tests for search helpers (pure functions).
 * These were previously duplicated in oracle-core.test.ts.
 */

import { describe, it, expect } from 'bun:test';
import {
  sanitizeFtsQuery,
  normalizeFtsScore,
  parseConceptsFromMetadata,
  combineResults,
  checkEmbeddingDimensionDrift,
  RRF_K,
} from '../search.ts';
import type { ToolContext } from '../types.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

function fakeCtx(vectorStore: VectorStoreAdapter): ToolContext {
  return { vectorStore } as ToolContext;
}

function fakeStore(overrides: Partial<VectorStoreAdapter> = {}): VectorStoreAdapter {
  return {
    name: 'fake',
    connect: async () => {},
    close: async () => {},
    ensureCollection: async () => {},
    deleteCollection: async () => {},
    addDocuments: async () => {},
    query: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    queryById: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    getStats: async () => ({ count: 0 }),
    getCollectionInfo: async () => ({ count: 0, name: 'fake' }),
    ...overrides,
  };
}

// ============================================================================
// sanitizeFtsQuery
// ============================================================================

describe('sanitizeFtsQuery', () => {
  it('should remove FTS5 special characters', () => {
    expect(sanitizeFtsQuery('hello?')).toBe('\"hello\"');
    expect(sanitizeFtsQuery('test*')).toBe('\"test\"');
    expect(sanitizeFtsQuery('a + b')).toBe('\"a\" OR \"b\"');
    expect(sanitizeFtsQuery('NOT this')).toBe('\"NOT\" OR \"this\"');
  });

  it('should handle quotes', () => {
    expect(sanitizeFtsQuery('\"exact phrase\"')).toBe('\"exact\" OR \"phrase\"');
    expect(sanitizeFtsQuery("it's a test")).toBe('\"it\" OR \"s\" OR \"a\" OR \"test\"');
  });

  it('should normalize whitespace', () => {
    expect(sanitizeFtsQuery('  hello   world  ')).toBe('\"hello\" OR \"world\"');
    expect(sanitizeFtsQuery('a  b  c')).toBe('\"a\" OR \"b\" OR \"c\"');
  });

  it('should return empty when no searchable tokens remain', () => {
    expect(sanitizeFtsQuery('???')).toBe('');
    expect(sanitizeFtsQuery('***')).toBe('');
  });

  it('should preserve valid queries', () => {
    expect(sanitizeFtsQuery('oracle philosophy')).toBe('\"oracle\" OR \"philosophy\"');
    expect(sanitizeFtsQuery('git safety')).toBe('\"git\" OR \"safety\"');
  });

  it('should handle colons which break FTS5', () => {
    expect(sanitizeFtsQuery('error: no such column')).toBe('\"error\" OR \"no\" OR \"such\" OR \"column\"');
    expect(sanitizeFtsQuery('time: 15:30')).toBe('\"time\" OR \"15\" OR \"30\"');
  });

  it('should handle forward slashes which break FTS5', () => {
    expect(sanitizeFtsQuery('Shopee/Lazada/TikTok')).toBe('\"Shopee\" OR \"Lazada\" OR \"TikTok\"');
    expect(sanitizeFtsQuery('path/to/file')).toBe('\"path\" OR \"to\" OR \"file\"');
  });
});

// ============================================================================
// normalizeFtsScore
// ============================================================================

describe('normalizeFtsScore', () => {
  it('should return values between 0 and 1', () => {
    for (let i = -100; i <= 0; i++) {
      const score = normalizeFtsScore(i);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('should give better scores for better ranks (closer to 0)', () => {
    expect(normalizeFtsScore(-1)).toBeGreaterThan(normalizeFtsScore(-5));
    expect(normalizeFtsScore(-5)).toBeGreaterThan(normalizeFtsScore(-10));
  });

  it('should provide exponential decay', () => {
    const score1 = normalizeFtsScore(-1);
    const score2 = normalizeFtsScore(-2);
    const score3 = normalizeFtsScore(-3);

    const ratio1 = score1 / score2;
    const ratio2 = score2 / score3;
    expect(ratio1).toBeCloseTo(ratio2, 1);
  });
});

// ============================================================================
// parseConceptsFromMetadata
// ============================================================================

describe('parseConceptsFromMetadata', () => {
  it('should handle null/undefined', () => {
    expect(parseConceptsFromMetadata(null)).toEqual([]);
    expect(parseConceptsFromMetadata(undefined)).toEqual([]);
  });

  it('should handle arrays', () => {
    expect(parseConceptsFromMetadata(['trust', 'safety'])).toEqual(['trust', 'safety']);
  });

  it('should parse JSON strings', () => {
    expect(parseConceptsFromMetadata('["trust","safety"]')).toEqual(['trust', 'safety']);
  });

  it('should return empty for invalid JSON', () => {
    expect(parseConceptsFromMetadata('not json')).toEqual([]);
  });
});

// ============================================================================
// combineResults
// ============================================================================

describe('combineResults', () => {
  const ftsResults = [
    { id: 'doc1', type: 'principle', content: 'Content 1', source_file: 'f1.md', concepts: ['trust'], score: 0.8, source: 'fts' as const },
    { id: 'doc2', type: 'learning', content: 'Content 2', source_file: 'f2.md', concepts: ['pattern'], score: 0.6, source: 'fts' as const },
  ];

  const vectorResults = [
    { id: 'doc1', type: 'principle', content: 'Content 1', source_file: 'f1.md', concepts: ['trust'], score: 0.9, source: 'vector' as const },
    { id: 'doc3', type: 'retro', content: 'Content 3', source_file: 'f3.md', concepts: ['decision'], score: 0.7, source: 'vector' as const },
  ];

  it('should mark duplicates as hybrid', () => {
    const combined = combineResults(ftsResults, vectorResults);
    const doc1 = combined.find(r => r.id === 'doc1');
    expect(doc1?.source).toBe('hybrid');
    expect(doc1?.ftsScore).toBe(0.8);
    expect(doc1?.vectorScore).toBe(0.9);
  });

  it('should keep FTS-only as fts source', () => {
    const combined = combineResults(ftsResults, vectorResults);
    expect(combined.find(r => r.id === 'doc2')?.source).toBe('fts');
  });

  it('should keep vector-only as vector source', () => {
    const combined = combineResults(ftsResults, vectorResults);
    expect(combined.find(r => r.id === 'doc3')?.source).toBe('vector');
  });

  it('should fuse hybrid results via Reciprocal Rank Fusion (rank 1 in both lists)', () => {
    const combined = combineResults(ftsResults, vectorResults);
    const doc1 = combined.find(r => r.id === 'doc1');
    // doc1 is rank 1 in both the FTS and vector lists: 1/(k+1) + 1/(k+1)
    const expected = 1 / (RRF_K + 1) + 1 / (RRF_K + 1);
    expect(doc1?.score).toBeCloseTo(expected, 6);
  });

  it('should rank a hybrid (both-list) hit above a single-list hit at the same rank', () => {
    const combined = combineResults(ftsResults, vectorResults);
    const doc1 = combined.find(r => r.id === 'doc1'); // hybrid, rank 1 in both
    const doc2 = combined.find(r => r.id === 'doc2'); // fts-only, rank 2
    expect(doc1!.score).toBeGreaterThan(doc2!.score);
  });

  it('should not require score normalization between FTS and vector scales', () => {
    // RRF only depends on rank position, not on the raw score magnitude,
    // so wildly different raw score scales should not affect fusion order.
    const skewedVector = [
      { id: 'doc1', type: 'principle', content: 'Content 1', source_file: 'f1.md', concepts: ['trust'], score: 9999, distance: 0, model: 'bge-m3', source: 'vector' as const },
      { id: 'doc3', type: 'retro', content: 'Content 3', source_file: 'f3.md', concepts: ['decision'], score: 9998, distance: 0, model: 'bge-m3', source: 'vector' as const },
    ];
    const combined = combineResults(ftsResults, skewedVector);
    const doc1 = combined.find(r => r.id === 'doc1');
    const expected = 1 / (RRF_K + 1) + 1 / (RRF_K + 1);
    expect(doc1?.score).toBeCloseTo(expected, 6);
  });

  it('should sort by score descending', () => {
    const combined = combineResults(ftsResults, vectorResults);
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i - 1].score).toBeGreaterThanOrEqual(combined[i].score);
    }
  });

  it('should handle empty inputs', () => {
    expect(combineResults([], [])).toEqual([]);
    expect(combineResults(ftsResults, [])).toHaveLength(2);
    expect(combineResults([], vectorResults)).toHaveLength(2);
  });
});

// ============================================================================
// checkEmbeddingDimensionDrift
// ============================================================================

describe('checkEmbeddingDimensionDrift', () => {
  it('returns undefined when the adapter does not report dimensions', async () => {
    const ctx = fakeCtx(fakeStore());
    expect(await checkEmbeddingDimensionDrift(ctx)).toBeUndefined();
  });

  it('returns undefined when stored dimension is unknown (empty collection)', async () => {
    const ctx = fakeCtx(fakeStore({
      getExpectedDimension: () => 1024,
      getStoredDimension: async () => null,
    }));
    expect(await checkEmbeddingDimensionDrift(ctx)).toBeUndefined();
  });

  it('returns undefined when expected and stored dimensions match', async () => {
    const ctx = fakeCtx(fakeStore({
      getExpectedDimension: () => 1024,
      getStoredDimension: async () => 1024,
    }));
    expect(await checkEmbeddingDimensionDrift(ctx)).toBeUndefined();
  });

  it('returns a warning when expected and stored dimensions disagree', async () => {
    const ctx = fakeCtx(fakeStore({
      getExpectedDimension: () => 768,
      getStoredDimension: async () => 1024,
    }));
    const warning = await checkEmbeddingDimensionDrift(ctx);
    expect(warning).toMatch(/dimension mismatch/i);
    expect(warning).toContain('768');
    expect(warning).toContain('1024');
  });

  it('never throws even if the adapter methods throw', async () => {
    const ctx = fakeCtx(fakeStore({
      getExpectedDimension: () => { throw new Error('boom'); },
    }));
    expect(await checkEmbeddingDimensionDrift(ctx)).toBeUndefined();
  });
});
