import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';

import { loadUnifiedPlugins, type UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';
import {
  startUnifiedPluginServers,
  type UnifiedServerRuntime,
} from '../../../src/plugins/unified-server.ts';

type TestServer = ReturnType<typeof Bun.serve>;

export interface PluginServerFixture {
  baseUrl: string;
  pluginName: string;
  runtime: UnifiedRuntime;
  servers: UnifiedServerRuntime;
  stop: () => Promise<void>;
}

interface FixtureOptions {
  autostart?: boolean;
  command?: string;
  args?: string[];
  flipHealth?: boolean;
  healthPath?: string;
  healthy?: boolean;
}

export async function createPluginServerFixture(
  options: FixtureOptions = {},
): Promise<PluginServerFixture> {
  const root = mkdtempSync(join(tmpdir(), 'arra-plugin-server-'));
  const pluginName = `self-server-${randomUUID().slice(0, 8)}`;
  writeServerPlugin(root, pluginName, options);
  const runtime = await loadUnifiedPlugins({ dirs: [root] });
  const servers = await startUnifiedPluginServers(runtime.servers);
  const http = serveRuntime(runtime);

  return {
    baseUrl: `http://127.0.0.1:${http.port}`,
    pluginName,
    runtime,
    servers,
    stop: async () => {
      await http.stop(true);
      await servers.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function serveRuntime(runtime: UnifiedRuntime): TestServer {
  const app = new Elysia();
  for (const route of runtime.routes) app.use(route as any);
  return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
}

function writeServerPlugin(root: string, pluginName: string, options: FixtureOptions) {
  const dir = join(root, pluginName);
  const healthPath = options.healthPath ?? '/health';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: pluginName,
    version: '1.0.0',
    entry: './index.ts',
    server: {
      command: options.command ?? 'bun',
      args: options.args ?? ['server.ts'],
      env: { PLUGIN_MESSAGE: 'pong' },
      healthPath,
      autostart: options.autostart,
    },
  }));
  writeFileSync(join(dir, 'index.ts'), 'export function noop() { return { ok: true }; }\n');
  writeFileSync(join(dir, 'server.ts'), serverSource(healthPath, options));
}

function serverSource(healthPath: string, options: FixtureOptions) {
  return `const port = Number(process.env.ARRA_PLUGIN_PORT || process.env.PORT);
let healthChecks = 0;
const healthy = ${options.healthy === false ? 'false' : 'true'};
const flipHealth = ${options.flipHealth ? 'true' : 'false'};
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === ${JSON.stringify(healthPath)}) {
      healthChecks += 1;
      const ok = healthy && (!flipHealth || healthChecks === 1);
      return Response.json({ ok, port }, { status: ok ? 200 : 500 });
    }
    if (url.pathname === '/crash') process.exit(1);
    if (url.pathname === '/echo') return Response.json({
      message: process.env.PLUGIN_MESSAGE || 'missing',
      plugin: req.headers.get('x-arra-plugin-name'),
      query: url.searchParams.get('q'),
    });
    return new Response('missing', { status: 404 });
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
`;
}
