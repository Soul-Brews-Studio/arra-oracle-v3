import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { generateDefaultConfig, loadVectorConfig, writeVectorConfig } from '../../src/vector/config.ts';
import { tempDir } from './helpers.ts';

test('vector config writer persists JSON that the loader can read back', () => {
  const config = generateDefaultConfig();
  const fp = join(tempDir(), 'vector-server.json');

  expect(writeVectorConfig(config, fp)).toBe(fp);
  expect(loadVectorConfig(fp)).toEqual(config);
});
