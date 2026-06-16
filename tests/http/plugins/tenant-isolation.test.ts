import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Elysia } from 'elysia';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { pluginByNameRoute } from '../../../src/routes/files/plugin-by-name.ts';
import { pluginsListRoute } from '../../../src/routes/files/plugins.ts';

const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedPluginDirs = process.env.ARRA_PLUGIN_DIRS;
const savedOraclePluginDir = process.env.ORACLE_PLUGIN_DIR;
let tmp = '';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;

type Handler = { handle: (request: Request) => Response | Promise<Response> };
type PluginList = { plugins: Array<{ name: string }>; dir?: string };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-tenant-'));
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedPluginDirs === undefined) delete process.env.ARRA_PLUGIN_DIRS;
  else process.env.ARRA_PLUGIN_DIRS = savedPluginDirs;
  if (savedOraclePluginDir === undefined) delete process.env.ORACLE_PLUGIN_DIR;
  else process.env.ORACLE_PLUGIN_DIR = savedOraclePluginDir;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function tenantPath(base: string, tenantId: string): string {
  return join(dirname(base), 'tenants', tenantId, basename(base));
}

function writeNestedPlugin(base: string, name: string, enabled = true): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    wasm: `${name}.wasm`,
    enabled,
  }, null, 2));
  writeFileSync(join(dir, `${name}.wasm`), WASM);
  return join(dir, 'plugin.json');
}

function writeFlatPlugin(base: string, name: string) {
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, `${name}.wasm`), WASM);
}

function pluginNames(body: PluginList): string[] {
  return body.plugins.map((plugin) => plugin.name).sort();
}

function tenantRequest(handler: Handler, tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => handler.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

describe('plugin routes tenant isolation', () => {
  test('lists only the active tenant plugin directory instead of the global registry', async () => {
    const base = join(tmp, 'plugins');
    writeNestedPlugin(base, 'global-plugin');
    writeNestedPlugin(tenantPath(base, tenantA), 'tenant-a-plugin');
    writeNestedPlugin(tenantPath(base, tenantB), 'tenant-b-plugin');

    const registryLeak = {
      name: 'registry-leak', version: '1.0.0', status: 'ok', surfaces: [], mcpTools: [],
      apiRoutes: [], proxy: [], cliSubcommands: [], exportFormats: [], file: '', size: 0,
      modified: new Date().toISOString(),
    };
    const app = new Elysia().use(createPluginsRouter({
      dir: base,
      registry: () => [registryLeak] as never,
    }));

    const globalBody = await (await app.handle(new Request('http://local/api/plugins'))).json() as PluginList;
    expect(pluginNames(globalBody)).toEqual(['registry-leak']);

    const body = await (await tenantRequest(app, tenantA, '/api/plugins')).json() as PluginList;
    expect(pluginNames(body)).toEqual(['tenant-a-plugin']);
    expect(body.dir).toContain(`/tenants/${tenantA}/plugins`);
  });

  test('serves wasm and toggles state only from the active tenant plugin dir', async () => {
    const base = join(tmp, 'plugins');
    process.env.ARRA_PLUGIN_DIRS = base;
    process.env.ORACLE_PLUGIN_DIR = base;
    const globalManifest = writeNestedPlugin(base, 'shared-plugin', true);
    const tenantManifest = writeNestedPlugin(tenantPath(base, tenantA), 'shared-plugin', true);
    writeNestedPlugin(tenantPath(base, tenantB), 'other-plugin', true);
    const app = new Elysia().use(createPluginsRouter({ dir: base }));

    const wasm = await tenantRequest(app, tenantA, '/api/plugins/shared-plugin');
    expect(wasm.status).toBe(200);
    expect(new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)).toEqual(WASM.slice(0, 4));
    expect((await tenantRequest(app, tenantB, '/api/plugins/shared-plugin')).status).toBe(404);

    const toggled = await tenantRequest(app, tenantA, '/api/plugins/shared-plugin/state', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggled.status).toBe(200);
    expect(JSON.parse(readFileSync(tenantManifest, 'utf8')).enabled).toBe(false);
    expect(JSON.parse(readFileSync(globalManifest, 'utf8')).enabled).toBe(true);
  });

  test('legacy flat plugin routes use the active tenant plugin directory', async () => {
    process.env.ORACLE_DATA_DIR = tmp;
    const base = join(tmp, 'plugins');
    writeFlatPlugin(base, 'global-flat');
    writeFlatPlugin(tenantPath(base, tenantA), 'tenant-flat');
    writeFlatPlugin(tenantPath(base, tenantB), 'other-flat');
    const app = new Elysia().use(pluginsListRoute).use(pluginByNameRoute);

    const body = await (await tenantRequest(app, tenantA, '/api/plugins')).json() as PluginList;
    expect(pluginNames(body)).toEqual(['tenant-flat']);
    expect((await tenantRequest(app, tenantA, '/api/plugins/tenant-flat')).status).toBe(200);
    expect((await tenantRequest(app, tenantB, '/api/plugins/tenant-flat')).status).toBe(404);
  });
});
