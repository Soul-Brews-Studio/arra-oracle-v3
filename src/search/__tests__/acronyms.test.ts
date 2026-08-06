import { describe, expect, test } from 'bun:test';
import { augmentQueryWithAcronyms, enrichTextWithAcronyms, expansionsForText } from '../acronyms.ts';

describe('acronym query augmentation and ingestion enrichment', () => {
  test('appends CORS, PNA, and vector preflight expansions to queries', () => {
    const query = augmentQueryWithAcronyms('CORS PNA vector URL preflight');

    expect(query).toStartWith('CORS PNA vector URL preflight');
    expect(query).toContain('Cross-Origin Resource Sharing');
    expect(query).toContain('Private Network Access');
    expect(query).toContain('Access-Control-Request-Private-Network');
    expect(query).toContain('vectorAvailable');
    expect(query).toContain('vectorMode');
  });

  test('detects full-form phrases and injects missing abbreviations for indexed text', () => {
    const content = enrichTextWithAcronyms('Browser Private Network Access checks the Vector URL during preflight.');

    expect(content).toContain('Search expansions:');
    expect(content).toContain('PNA');
    expect(content).toContain('VECTOR_URL');
    expect(content).toContain('vectorAvailable');
  });

  test('does not duplicate full forms already present in the source text', () => {
    const additions = expansionsForText('CORS means Cross-Origin Resource Sharing.');

    expect(additions).toContain('Access-Control-Allow-Origin');
    expect(additions).not.toContain('CORS');
    expect(additions).not.toContain('Cross-Origin Resource Sharing');
  });
});
