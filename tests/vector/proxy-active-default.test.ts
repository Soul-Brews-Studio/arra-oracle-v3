import { expect, test } from 'bun:test';
import { activeVectorProxyManifest } from '../../src/vector/proxy-manifest.ts';
import { defaultVectorProxyManifest, generateDefaultConfig } from '../../src/vector/config.ts';

test('active vector proxy manifest falls back to the default vector sidecar manifest', () => {
  const config = { ...generateDefaultConfig(), proxy: undefined };

  expect(activeVectorProxyManifest(config)).toEqual(defaultVectorProxyManifest());
});
