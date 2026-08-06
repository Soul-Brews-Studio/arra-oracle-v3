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
  applyEntityLinkBoost,
} from '../search.ts';

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

  it('should append acronym expansions to MCP search tokens', () => {
    const query = sanitizeFtsQuery('CORS PNA vector URL preflight');
    expect(query).toContain('\"Cross\" OR \"Origin\" OR \"Resource\" OR \"Sharing\"');
    expect(query).toContain('\"Access\" OR \"Control\" OR \"Allow\"');
    expect(query).toContain('\"vectorAvailable\"');
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

  it('should apply 10% boost for hybrid results', () => {
    const combined = combineResults(ftsResults, vectorResults, 0.5, 0.5);
    const doc1 = combined.find(r => r.id === 'doc1');
    // ((0.5 * 0.8) + (0.5 * 0.9)) * 1.1 = 0.935
    expect(doc1?.score).toBeCloseTo(0.935, 2);
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
// applyEntityLinkBoost
// ============================================================================

describe('applyEntityLinkBoost', () => {
  const results = [
    { id: 'plain', type: 'learning', content: 'Plain', source_file: 'plain.md', concepts: [], score: 0.6, source: 'fts' as const },
    { id: 'linked', type: 'learning', content: 'Linked', source_file: 'linked.md', concepts: [], score: 0.45, source: 'fts' as const },
  ];

  it('should boost linked documents enough to affect rank', () => {
    const boosted = applyEntityLinkBoost(results, [
      { sourceDocId: 'linked', entity: 'Cloudflare Workers', score: 0.9 },
    ]);

    expect(boosted.boosted).toBe(1);
    expect(boosted.results[0].id).toBe('linked');
    expect(boosted.results[0].entityLinkScore).toBe(0.9);
    expect(boosted.results[0].entityLinkMatches).toEqual(['Cloudflare Workers']);
  });

  it('should leave scores and order unchanged when no entity hits match', () => {
    const boosted = applyEntityLinkBoost(results, [
      { sourceDocId: 'other', entity: 'Other', score: 1 },
    ]);

    expect(boosted.boosted).toBe(0);
    expect(boosted.results.map((result) => result.id)).toEqual(['plain', 'linked']);
    expect(boosted.results.map((result) => result.score)).toEqual([0.6, 0.45]);
  });
});
