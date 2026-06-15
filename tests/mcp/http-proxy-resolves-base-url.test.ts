import { expect, test } from 'bun:test';
import { resolveOracleApiBase } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy base resolver trims usable API URLs', () => {
  process.env.ORACLE_HTTP_URL = ' http://127.0.0.1:47778/// ';
  expect(resolveOracleApiBase()).toBe('http://127.0.0.1:47778');
});
