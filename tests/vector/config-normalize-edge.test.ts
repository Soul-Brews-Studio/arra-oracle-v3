import { expect, test } from 'bun:test';
import { generateDefaultConfig } from '../../src/vector/config.ts';
import { normalizeVectorConfig } from '../../src/vector/config-normalize.ts';

test('vector config normalizer treats malformed configs as legacy defaults', () => {
  const defaults = generateDefaultConfig();
  const config = normalizeVectorConfig(['bad'], defaults);

  expect(config.version).toBe('legacy');
  expect(config.collections).toEqual(defaults.collections);
  expect(config.storage).toBeUndefined();
});

test('vector config normalizer backfills v2 storage and empty collections', () => {
  const defaults = generateDefaultConfig();
  const config = normalizeVectorConfig({ version: '2.0', enabled: true }, defaults);

  expect(config.version).toBe('2.0');
  expect(config.enabled).toBe(true);
  expect(config.collections).toEqual({});
  expect(config.storage).toEqual(defaults.storage);
});
