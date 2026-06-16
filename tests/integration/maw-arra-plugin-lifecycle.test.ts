import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins, type UnifiedRuntime } from '../../src/plugins/unified-loader.ts';
import { stopUnifiedPluginServers } from '../../src/plugins/unified-server.ts';
import { runCli } from '../cli/_run.ts';

const savedEnv = {
  proxyUrl: process.env.ARRA_LIFECYCLE_PROXY_URL,
  marker: process.env.ARRA_LIFECYCLE_MARKER,
  startTimeout: process.env.ARRA_PLUGIN_START_TIMEOUT_MS,
  healthTimeout: process.env.ARRA_PLUGIN_HEALTH_TIMEOUT_MS,
};

let root = '';
let marker = '';
let runtime: UnifiedRuntime | undefined;
let appServer: ReturnType<typeof Bun.serve> | undefined;
let upstream: ReturnType<typeof Bun.serve> | undefined;

function writeLifecyclePlugin(home: string) {
  const dir = join(home, '.arra', 'plugins', 'arra');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: 'arra',
    version: '1.0.0',
    entry: './index.ts',
    lifecycle: { init: 'init', destroy: 'destroy' },
    apiRoutes: [{ path: '/api/plugins/arra', methods: ['GET'], handler: 'arraHttpRoute' }],
    cliSubcommands: [{ command: 'arra', help: 'maw arra <status>', handler: 'arraCli' }],
    server: { command: 'bun', args: ['server.ts'], healthPath: '/health', autostart: false },
    proxy: [{ path: '/api/plugins/arra/proxy', targetEnv: 'ARRA_LIFECYCLE_PROXY_URL', stripPrefix: true }],
  }, null, 2));
  writeFileSync(join(dir, 'index.ts'), `
import { appendFileSync } from 'node:fs';
function mark(phase) { appendFileSync(process.env.ARRA_LIFECYCLE_MARKER, phase + '\\n'); }
export function init(ctx) { mark('init:' + ctx.plugin); return { ok: true }; }
export function destroy(ctx) { mark('destroy:' + ctx.plugin); return { ok: true }; }
export function arraCli(ctx) { return { ok: true, output: 'arra cli ' + ctx.args.join('|') }; }
export function arraHttpRoute(ctx) {
  return { ok: true, body: { plugin: ctx.plugin, surface: ctx.source, query: ctx.query } };
}
`);
  writeFileSync(join(dir, 'server.ts'), `
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.ARRA_PLUGIN_PORT || process.env.PORT),
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true, plugin: process.env.ARRA_PLUGIN_NAME });
    if (url.pathname === '/ping') return Response.json({ pong: true, plugin: req.headers.get('x-arra-plugin-name'), q: url.searchParams.get('q') });
    return new Response('missing', { status: 404 });
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
`);
  return dir;
}

function serveRuntime(rt: UnifiedRuntime) {
  const app = new Elysia();
  for (const route of rt.routes) app.use(route as never);
  return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
}

async function json(path: string, init: RequestInit = {}) {
  const res = await fetch(`${appServer!.url}${path}`, init);
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'maw-arra-plugin-lifecycle-'));
  marker = join(root, 'lifecycle.log');
  writeLifecyclePlugin(root);
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/echo') return Response.json({ proxied: true, q: url.searchParams.get('q') });
      return new Response('missing', { status: 404 });
    },
  });
  process.env.ARRA_LIFECYCLE_PROXY_URL = String(upstream.url).replace(/\/$/, '');
  process.env.ARRA_LIFECYCLE_MARKER = marker;
  process.env.ARRA_PLUGIN_START_TIMEOUT_MS = '2000';
  process.env.ARRA_PLUGIN_HEALTH_TIMEOUT_MS = '500';
  runtime = await loadUnifiedPlugins({ dirs: [join(root, '.arra', 'plugins')], timeoutMs: 1000 });
  appServer = serveRuntime(runtime);
});

afterAll(async () => {
  await runtime?.stop();
  await stopUnifiedPluginServers(runtime?.servers);
  await appServer?.stop(true);
  await upstream?.stop(true);
  if (savedEnv.proxyUrl === undefined) delete process.env.ARRA_LIFECYCLE_PROXY_URL;
  else process.env.ARRA_LIFECYCLE_PROXY_URL = savedEnv.proxyUrl;
  if (savedEnv.marker === undefined) delete process.env.ARRA_LIFECYCLE_MARKER;
  else process.env.ARRA_LIFECYCLE_MARKER = savedEnv.marker;
  if (savedEnv.startTimeout === undefined) delete process.env.ARRA_PLUGIN_START_TIMEOUT_MS;
  else process.env.ARRA_PLUGIN_START_TIMEOUT_MS = savedEnv.startTimeout;
  if (savedEnv.healthTimeout === undefined) delete process.env.ARRA_PLUGIN_HEALTH_TIMEOUT_MS;
  else process.env.ARRA_PLUGIN_HEALTH_TIMEOUT_MS = savedEnv.healthTimeout;
  if (root) rmSync(root, { recursive: true, force: true });
});

test('maw arra plugin lifecycle loads, registers CLI, mounts HTTP, serves standalone, and proxies', async () => {
  expect(runtime?.pluginRegistry()[0]).toMatchObject({ name: 'arra', status: 'ok' });
  expect(runtime?.cliSubcommands).toContainEqual(expect.objectContaining({ plugin: 'arra', command: 'arra' }));
  expect(runtime?.servers).toContainEqual(expect.objectContaining({ plugin: 'arra', routePrefix: '/api/plugins/arra/server' }));

  await runtime!.init();
  expect(readFileSync(marker, 'utf8')).toContain('init:arra');

  const cli = await runCli(['arra', 'status', '--json'], {
    HOME: root,
    ARRA_LIFECYCLE_MARKER: marker,
    ARRA_LIFECYCLE_PROXY_URL: process.env.ARRA_LIFECYCLE_PROXY_URL!,
  });
  expect(cli.code).toBe(0);
  expect(cli.stdout).toContain('loaded');
  expect(cli.stdout).toContain('arra cli status|--json');

  const http = await json('/api/plugins/arra?view=registry');
  expect(http.status).toBe(200);
  expect(http.body).toMatchObject({ plugin: 'arra', surface: 'api', query: { view: 'registry' } });

  const standalone = await json('/api/plugins/arra/server/ping?q=serve');
  expect(standalone.status).toBe(200);
  expect(standalone.body).toEqual({ pong: true, plugin: 'arra', q: 'serve' });

  const proxied = await json('/api/plugins/arra/proxy/echo?q=proxy');
  expect(proxied.status).toBe(200);
  expect(proxied.body).toEqual({ proxied: true, q: 'proxy' });
  expect(proxied.headers.get('x-unified-proxy-target')).toContain('127.0.0.1');

  await runtime!.stop();
  expect(readFileSync(marker, 'utf8')).toContain('destroy:arra');
}, 15_000);
