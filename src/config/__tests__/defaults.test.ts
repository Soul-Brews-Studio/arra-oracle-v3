import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SAFE_VECTOR_ENGINE,
  DEFAULT_VECTOR_COLLECTION,
  detectDefaultVectorBackend,
} from '../defaults.ts';

describe('default-safe vector backend resolution', () => {
  test('first run resolves sqlite-vec without a provider prompt', () => {
    expect(DEFAULT_SAFE_VECTOR_ENGINE).toBe('sqlite-vec');
    expect(DEFAULT_VECTOR_COLLECTION).toMatchObject({ key: 'bge-m3', adapter: 'sqlite-vec' });
    expect(detectDefaultVectorBackend()).toMatchObject({
      engine: 'sqlite-vec',
      source: 'first-run-default',
      returningUser: false,
      providerPrompt: false,
      wizard: 'optional',
    });
  });

  test('returning users keep detected backend choices', () => {
    expect(detectDefaultVectorBackend({ configuredEngine: 'lancedb', hasExistingIndex: true })).toMatchObject({
      engine: 'lancedb',
      source: 'detect',
      returningUser: true,
    });
  });
});
