import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createTenantFetch, runWithTenant, tenantDataPath, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { pluginDir } from '../../plugins/_fixtures.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-tenant-'));
const pluginBase = join(tmp, 'plugins');
const previousOraclePluginDir = process.env.ORACLE_PLUGIN_DIR;
const previousArraPluginDirs = process.env.ARRA_PLUGIN_DIRS;

process.env.ORACLE_PLUGIN_DIR = pluginBase;
process.env.ARRA_PLUGIN_DIRS = pluginBase;

const app = new Elysia().use(createPluginsRouter({ dir: pluginBase }));
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `plugins-a-${stamp}`;
const tenantB = `plugins-b-${stamp}`;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function tenantPluginRoot(tenantId: string): string {
  return runWithTenant(tenantId, () => tenantDataPath(pluginBase));
}

function seedPlugin(tenantId: string, name: string) {
  const root = tenantPluginRoot(tenantId);
  mkdirSync(root, { recursive: true });
  const dir = pluginDir(root, name, { description: `tenant ${tenantId}`, wasm: 'plugin.wasm', enabled: true });
  writeFileSync(join(dir, 'plugin.wasm'), new Uint8Array([0, 97, 115, 109]));
  return dir;
}

const aOnlyDir = seedPlugin(tenantA, 'tenant-a-only');
const bOnlyDir = seedPlugin(tenantB, 'tenant-b-only');
const sharedADir = seedPlugin(tenantA, 'shared-plugin');
const sharedBDir = seedPlugin(tenantB, 'shared-plugin');

function request(tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((req) => app.handle(req))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function manifest(path: string): { enabled?: boolean } {
  return JSON.parse(readFileSync(join(path, 'plugin.json'), 'utf8')) as { enabled?: boolean };
}

afterAll(() => {
  restore('ORACLE_PLUGIN_DIR', previousOraclePluginDir);
  restore('ARRA_PLUGIN_DIRS', previousArraPluginDirs);
  rmSync(tmp, { recursive: true, force: true });
});

describe('tenant-scoped plugin routes', () => {
  test('lists and downloads only plugins from the active tenant directory', async () => {
    const listed = await request(tenantA, '/api/plugins');
    const body = await listed.json() as { dir: string; plugins: Array<{ name: string }> };
    const names = body.plugins.map((plugin) => plugin.name).sort();

    expect(listed.status).toBe(200);
    expect(body.dir).toBe(tenantPluginRoot(tenantA));
    expect(names).toEqual(['shared-plugin', 'tenant-a-only']);
    expect(names).not.toContain('tenant-b-only');

    expect((await request(tenantA, '/api/plugins/tenant-a-only')).status).toBe(200);
    expect((await request(tenantA, '/api/plugins/tenant-b-only')).status).toBe(404);
  });

  test('writes plugin state only in the active tenant directory', async () => {
    const response = await request(tenantA, '/api/plugins/shared-plugin/state', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    const body = await response.json() as { enabled: boolean; plugin: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ enabled: false, plugin: 'shared-plugin' });
    expect(manifest(sharedADir).enabled).toBe(false);
    expect(manifest(sharedBDir).enabled).toBe(true);
    expect(manifest(aOnlyDir).enabled).toBe(true);
    expect(manifest(bOnlyDir).enabled).toBe(true);
  });
});
