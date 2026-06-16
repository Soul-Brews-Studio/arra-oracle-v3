import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins, type UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';
import { stopUnifiedPluginServers } from '../../../src/plugins/unified-server.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { runCli } from '../../cli/_run.ts';

const previousDirs = process.env.ARRA_PLUGIN_DIRS;
let root = '';
let home = '';
let runtime: UnifiedRuntime;
let app: Elysia;

function writeE2ePlugin(base: string) {
  const dir = join(base, 'registry-e2e');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: 'registry-e2e',
    version: '1.0.0',
    entry: './index.ts',
    description: 'E2E registry plugin',
    apiRoutes: [{ path: '/api/e2e/echo', methods: ['GET', 'POST'], handler: 'apiEcho' }],
    cliSubcommands: [{ command: 'e2e-echo', help: 'echo through plugin registry', handler: 'cliEcho' }],
    menu: [{ label: 'E2E Plugin', path: '/plugins/e2e', group: 'tools' }],
    server: {
      command: 'bun',
      args: ['server.ts'],
      env: { E2E_SERVER_MESSAGE: 'standalone-ok' },
      healthPath: '/health',
      autostart: false,
    },
  }, null, 2));
  writeFileSync(join(dir, 'index.ts'), `
export function cliEcho(ctx) {
  return { ok: true, output: ['cli-ok', ...ctx.args].join(':') };
}
export function apiEcho(ctx) {
  return { ok: true, body: { ok: true, plugin: ctx.plugin, source: ctx.source, q: ctx.query.q ?? null, body: ctx.body ?? null } };
}
`);
  writeFileSync(join(dir, 'server.ts'), `
const port = Number(process.env.ARRA_PLUGIN_PORT || process.env.PORT);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true, port });
    if (url.pathname === '/echo') return Response.json({
      message: process.env.E2E_SERVER_MESSAGE,
      plugin: req.headers.get('x-arra-plugin-name'),
      q: url.searchParams.get('q'),
    });
    return new Response('missing', { status: 404 });
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
`);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://local${path}`, init));
}

describe('plugin system E2E through registry surfaces', () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'arra-plugin-e2e-home-'));
    root = join(home, '.arra', 'plugins');
    writeE2ePlugin(root);
    process.env.ARRA_PLUGIN_DIRS = root;
    runtime = await loadUnifiedPlugins({ dirs: [root] });
    app = new Elysia().use(createPluginsRouter({ dir: root, registry: runtime.pluginRegistry }));
    for (const route of runtime.routes) app.use(route as never);
  });

  afterAll(async () => {
    await stopUnifiedPluginServers(runtime?.servers);
    if (previousDirs === undefined) delete process.env.ARRA_PLUGIN_DIRS;
    else process.env.ARRA_PLUGIN_DIRS = previousDirs;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test('registry advertises CLI, HTTP, menu, and standalone server surfaces', async () => {
    const res = await request('/api/plugins');
    expect(res.status).toBe(200);
    const body = await res.json() as { plugins: Array<{ name: string; surfaces: string[]; server?: object }> };
    const plugin = body.plugins.find((item) => item.name === 'registry-e2e');

    expect(plugin?.surfaces).toEqual(['apiRoutes', 'server', 'menu', 'cliSubcommands']);
    expect(plugin?.server).toMatchObject({ command: 'bun', args: ['server.ts'], healthPath: '/health' });
  });

  test('CLI verb is discovered and invoked through the plugin registry', async () => {
    const help = await runCli(['-h', 'e2e-echo'], { HOME: home, ARRA_PLUGIN_TIMEOUT_MS: '1000' });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('e2e-echo — echo through plugin registry');

    const result = await runCli(['e2e-echo', 'alpha', 'beta'], { HOME: home, ARRA_PLUGIN_TIMEOUT_MS: '1000' });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('cli-ok:alpha:beta');
  }, 20_000);

  test('HTTP endpoint registered by the plugin handles query and JSON body', async () => {
    const res = await request('/api/e2e/echo?q=query-ok', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'body-ok' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      plugin: 'registry-e2e',
      source: 'api',
      q: 'query-ok',
      body: { payload: 'body-ok' },
    });
  });

  test('standalone plugin serve starts lazily and proxies through registry route', async () => {
    const health = await request('/api/plugins/registry-e2e/server/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, plugin: 'registry-e2e', healthy: true });

    const proxied = await request('/api/plugins/registry-e2e/server/echo?q=serve-ok');
    expect(proxied.status).toBe(200);
    expect(await proxied.json()).toEqual({
      message: 'standalone-ok',
      plugin: 'registry-e2e',
      q: 'serve-ok',
    });
  });

  test('state endpoint toggles the same registry-backed manifest', async () => {
    const res = await request('/api/plugins/registry-e2e/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, plugin: 'registry-e2e', enabled: false });
  });
});
