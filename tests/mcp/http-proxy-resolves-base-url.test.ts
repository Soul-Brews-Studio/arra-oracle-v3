import { expect, test } from 'bun:test';
import { resolveOracleApiBase } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy base resolver trims usable API URLs', () => {
  withApiEnv(' http://127.0.0.1:47778/// ', () => {
    expect(resolveOracleApiBase()).toBe('http://127.0.0.1:47778');
  });
});

test('HTTP proxy base resolver drops accidental query and hash fragments', () => {
  withApiEnv(' https://oracle.test/base/?debug=1#frag ', () => {
    expect(resolveOracleApiBase()).toBe('https://oracle.test/base');
  });
});

function withApiEnv(value: string, callback: () => void): void {
  const previous = process.env.ORACLE_HTTP_URL;
  process.env.ORACLE_HTTP_URL = value;
  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.ORACLE_HTTP_URL;
    else process.env.ORACLE_HTTP_URL = previous;
  }
}
