import { expect, test } from 'bun:test';
import { resolveOracleApiBase } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy base resolver skips blank higher-priority env vars', () => {
  const previous = snapshotApiEnv();
  try {
    process.env.ORACLE_HTTP_URL = '  ';
    process.env.ORACLE_API = ' http://127.0.0.1:47778/// ';
    delete process.env.NEO_ARRA_API;
    expect(resolveOracleApiBase()).toBe('http://127.0.0.1:47778');
  } finally {
    restoreApiEnv(previous);
  }
});

function snapshotApiEnv() {
  return {
    ORACLE_HTTP_URL: process.env.ORACLE_HTTP_URL,
    ORACLE_API: process.env.ORACLE_API,
    NEO_ARRA_API: process.env.NEO_ARRA_API,
  };
}

function restoreApiEnv(env: ReturnType<typeof snapshotApiEnv>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
