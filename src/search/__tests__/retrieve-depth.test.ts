import { describe, expect, test } from 'bun:test';
import { candidatePoolSize, configuredRetrieveDepth, DEFAULT_RETRIEVE_DEPTH, MAX_RETRIEVE_DEPTH } from '../retrieve-depth.ts';

describe('retrieve depth config', () => {
  test('defaults per-retriever candidate pools to around 100', () => {
    expect(DEFAULT_RETRIEVE_DEPTH).toBe(100);
    expect(candidatePoolSize(3, {})).toBe(100);
    expect(candidatePoolSize(150, {})).toBe(150);
  });

  test('allows bounded env override without shrinking below requested top k', () => {
    expect(configuredRetrieveDepth({ ORACLE_RETRIEVE_DEPTH: '80' })).toBe(80);
    expect(candidatePoolSize(10, { ORACLE_RETRIEVE_DEPTH: '80' })).toBe(80);
    expect(candidatePoolSize(120, { ORACLE_RETRIEVE_DEPTH: '80' })).toBe(120);
    expect(configuredRetrieveDepth({ ORACLE_RETRIEVE_DEPTH: String(MAX_RETRIEVE_DEPTH + 1) })).toBe(MAX_RETRIEVE_DEPTH);
  });
});
