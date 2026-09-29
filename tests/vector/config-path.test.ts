import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { configPath } from '../../src/vector/config.ts';

test('vector config path resolves inside the supplied data directory', () => {
  expect(configPath('/tmp/oracle-data')).toBe(join('/tmp/oracle-data', 'vector-server.json'));
});

test('default vector config path honors the private deployment override', () => {
  const previous = process.env.ORACLE_VECTOR_CONFIG_PATH;
  process.env.ORACLE_VECTOR_CONFIG_PATH = '/etc/arra-oracle/vector-server.json';
  try {
    expect(configPath()).toBe('/etc/arra-oracle/vector-server.json');
    expect(configPath('/tmp/oracle-data')).toBe(join('/tmp/oracle-data', 'vector-server.json'));
  } finally {
    if (previous === undefined) delete process.env.ORACLE_VECTOR_CONFIG_PATH;
    else process.env.ORACLE_VECTOR_CONFIG_PATH = previous;
  }
});
