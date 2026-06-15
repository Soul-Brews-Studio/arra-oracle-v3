import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { configPath } from '../../src/vector/config.ts';

test('vector config path resolves inside the supplied data directory', () => {
  expect(configPath('/tmp/oracle-data')).toBe(join('/tmp/oracle-data', 'vector-server.json'));
});
