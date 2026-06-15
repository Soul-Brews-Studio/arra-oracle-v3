import { expect, test } from 'bun:test';
import { resolveOracleApiBase } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy base resolver treats embedded aliases as direct mode', () => {
  process.env.ORACLE_HTTP_URL = 'embedded';
  process.env.ORACLE_API = '';
  process.env.NEO_ARRA_API = '';
  expect(resolveOracleApiBase()).toBeNull();
});
