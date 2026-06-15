import { expect, test } from 'bun:test';
import { activeVectorProxyManifest } from '../../src/vector/proxy-manifest.ts';
import { generateDefaultConfig } from '../../src/vector/config.ts';

test('active vector proxy manifest uses config entries when present', () => {
  const proxy = [{ path: '/api/custom-vector', targetEnv: 'CUSTOM_VECTOR_URL' }];

  expect(activeVectorProxyManifest({ ...generateDefaultConfig(), proxy })).toEqual(proxy);
});
