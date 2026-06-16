import { expect, test } from 'bun:test';
import { defaultVectorProxyManifest, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config defaults stay FTS-first with a sidecar proxy manifest', () => {
  const defaults = generateDefaultConfig();

  expect(defaults.embedder).toBeUndefined();
  expect(defaults.proxy).toEqual(defaultVectorProxyManifest());
  expect(defaults.collections['bge-m3'].provider).toBe('ollama');
  expect(defaults.collections['bge-m3'].embedder).toMatchObject({ backend: 'ollama', model: 'bge-m3' });
});
