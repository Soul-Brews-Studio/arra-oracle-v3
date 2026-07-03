import { expect, test } from 'bun:test';
import {
  resolveEmbeddingProvider,
  resolveVectorBackend,
} from '../../src/vector/backend-resolution.ts';
import { generateDefaultConfig } from '../../src/vector/config.ts';

test('fresh installs resolve a local vector backend without provider prompt', () => {
  const cfg = generateDefaultConfig();
  const resolution = resolveVectorBackend(cfg, 'defaults', {});

  expect(resolution).toMatchObject({
    engine: 'lancedb',
    source: 'first-run-default',
    localDefault: true,
    returningUser: false,
    providerPrompt: false,
    wizard: 'optional',
  });
});

test('returning users keep configured backend and embedding provider', () => {
  const cfg = generateDefaultConfig();
  cfg.dataPath = '/data/vectors.db';
  cfg.collections['bge-m3'].adapter = 'sqlite-vec';
  cfg.collections['bge-m3'].provider = 'gemini';

  expect(resolveVectorBackend(cfg, 'file', {})).toMatchObject({
    engine: 'sqlite-vec',
    source: 'config',
    returningUser: true,
    providerPrompt: false,
  });
  expect(resolveEmbeddingProvider(cfg, 'file')).toMatchObject({
    provider: 'gemini',
    source: 'config',
    returningUser: true,
    providerPrompt: false,
  });
});

test('ORACLE_VECTOR_DB can select sqlite-vec as the safe local default', () => {
  const cfg = generateDefaultConfig();
  const resolution = resolveVectorBackend(cfg, 'defaults', { ORACLE_VECTOR_DB: 'sqlite-vec' });

  expect(resolution).toMatchObject({
    engine: 'sqlite-vec',
    source: 'env',
    localDefault: true,
    providerPrompt: false,
  });
  expect(resolution.dataPath.endsWith('vectors.db')).toBe(true);
});
