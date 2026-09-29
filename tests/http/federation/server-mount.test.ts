import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyHttpPluginRuntime } from '../../../src/mcp/http-policy.ts';

const keys = ['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_EMBEDDER', 'ORACLE_ENABLED_PLUGINS', 'ORACLE_DISABLED_PLUGINS', 'ARRA_API_KEY'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const scratch = mkdtempSync(join(tmpdir(), 'arra-federation-mount-'));
process.env.ORACLE_DATA_DIR = scratch;
process.env.ORACLE_DB_PATH = join(scratch, 'oracle.db');
process.env.ORACLE_EMBEDDER = 'none';
const { createApp } = await import('../../../src/server.ts');

afterEach(() => {
  for (const key of keys.slice(3)) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
afterAll(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  rmSync(scratch, { recursive: true, force: true });
});

test('explicitly enabled federation is mounted and still requires API authorization', async () => {
  process.env.ORACLE_ENABLED_PLUGINS = 'federation';
  process.env.ORACLE_DISABLED_PLUGINS = '';
  process.env.ARRA_API_KEY = 'federation-test-key';
  const app = createApp({ unifiedPlugins: emptyHttpPluginRuntime(), dataDir: scratch, vectorUrl: '' });
  for (const path of ['/api/federation/status', '/api/federation/capabilities']) {
    expect((await app.handle(new Request(`http://local${path}`))).status).toBe(401);
    const response = await app.handle(new Request(`http://local${path}`, { headers: { authorization: 'Bearer federation-test-key' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toBeObject();
  }
});

test('disabled federation overrides enablement', async () => {
  process.env.ORACLE_ENABLED_PLUGINS = 'federation';
  process.env.ORACLE_DISABLED_PLUGINS = 'federation';
  delete process.env.ARRA_API_KEY;
  const app = createApp({ unifiedPlugins: emptyHttpPluginRuntime(), dataDir: scratch, vectorUrl: '' });
  expect((await app.handle(new Request('http://local/api/federation/status'))).status).toBe(404);
});
