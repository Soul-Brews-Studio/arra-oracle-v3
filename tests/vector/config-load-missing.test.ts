import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadVectorConfig } from '../../src/vector/config.ts';
import { tempDir } from './helpers.ts';

test('vector config loader returns null when the config file is absent', () => {
  expect(loadVectorConfig(join(tempDir(), 'missing-vector-server.json'))).toBeNull();
});
