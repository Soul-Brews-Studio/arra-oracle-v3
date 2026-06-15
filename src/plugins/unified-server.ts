import { Elysia } from 'elysia';
import type { UnifiedServerManifest } from './unified-manifest.ts';

type Spawned = ReturnType<typeof Bun.spawn>;

export interface UnifiedPluginServer extends UnifiedServerManifest {
  plugin: string;
  dir: string;
  routePrefix: string;
}

interface RunningServer {
  config: UnifiedPluginServer;
  process: Spawned;
  baseUrl: string;
  port: number;
  startedAt: string;
}

interface HealthResult {
  healthy: boolean;
  healthPath: string;
  status?: number;
  error?: string;
}

interface ServerFailure {
  ok: false;
  status: number;
  error: string;
  plugin: string;
}

interface ServerSuccess {
  ok: true;
  running: RunningServer;
  health: HealthResult;
}

export interface UnifiedServerRuntime {
  started: number;
  stop: () => Promise<void>;
}

const startTimeoutMs = () => Number(process.env.ARRA_PLUGIN_START_TIMEOUT_MS ?? 4000);
const healthTimeoutMs = () => Number(process.env.ARRA_PLUGIN_HEALTH_TIMEOUT_MS ?? 500);
const running = new Map<string, RunningServer>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const healthPathFor = (server: UnifiedPluginServer) => server.healthPath ?? '/health';
const shouldAutostart = (server: UnifiedPluginServer) => server.autostart !== false;

function failure(plugin: string, status: number, error: string): ServerFailure {
  return { ok: false, plugin, status, error };
}

function serverMap(servers: UnifiedPluginServer[]) {
  return new Map(servers.map((server) => [server.plugin, server]));
}

function childEnv(server: UnifiedPluginServer, port: number) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return {
    ...env,
    ...(server.env ?? {}),
    ARRA_PLUGIN_NAME: server.plugin,
    ARRA_PLUGIN_PORT: String(port),
    PORT: String(port),
  };
}

async function allocatePort(): Promise<number> {
  const reservation = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('reserved'),
  });
  const { port } = reservation;
  await reservation.stop(true);
  if (!port) throw new Error('failed to allocate plugin server port');
  return port;
}

async function health(r: RunningServer): Promise<HealthResult> {
  const healthPath = healthPathFor(r.config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), healthTimeoutMs());
  try {
    const res = await fetch(new URL(healthPath, r.baseUrl), { signal: controller.signal });
    return { healthy: res.ok, status: res.status, healthPath };
  } catch (error) {
    return {
      healthy: false,
      healthPath,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(r: RunningServer): Promise<HealthResult> {
  const deadline = Date.now() + startTimeoutMs();
  let last: HealthResult = { healthy: false, healthPath: healthPathFor(r.config) };
  while (Date.now() < deadline) {
    last = await health(r);
    if (last.healthy) return last;
    await sleep(100);
  }
  return last;
}

async function spawnServer(config: UnifiedPluginServer): Promise<RunningServer> {
  const port = await allocatePort();
  const process = Bun.spawn([config.command, ...(config.args ?? [])], {
    cwd: config.dir,
    env: childEnv(config, port),
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const r: RunningServer = {
    config,
    process,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  };
  process.exited.finally(() => {
    if (running.get(config.plugin)?.process === process) running.delete(config.plugin);
  });
  return r;
}

async function ensureServer(config: UnifiedPluginServer): Promise<ServerSuccess | ServerFailure> {
  const existing = running.get(config.plugin);
  if (existing) return { ok: true, running: existing, health: await health(existing) };

  try {
    const r = await spawnServer(config);
    running.set(config.plugin, r);
    const result = await waitForHealth(r);
    if (result.healthy) return { ok: true, running: r, health: result };
    r.process.kill();
    running.delete(config.plugin);
    return failure(config.plugin, 502, result.error ?? 'plugin server health check failed');
  } catch (error) {
    return failure(config.plugin, 500, error instanceof Error ? error.message : String(error));
  }
}

async function stopServer(plugin: string): Promise<void> {
  const r = running.get(plugin);
  if (!r) return;
  running.delete(plugin);
  try {
    r.process.kill();
    await Promise.race([r.process.exited.catch(() => undefined), sleep(500)]);
  } catch {
    // best effort shutdown
  }
}

function sendFailure(set: { status?: number | string }, result: ServerFailure) {
  set.status = result.status;
  return { ok: false, plugin: result.plugin, error: result.error };
}

export async function startUnifiedPluginServers(
  servers: UnifiedPluginServer[],
  warn: (message: string) => void = console.warn,
): Promise<UnifiedServerRuntime> {
  let started = 0;
  for (const server of servers.filter(shouldAutostart)) {
    const result = await ensureServer(server);
    if (result.ok) started += 1;
    else warn(`[unified-plugin] server ${server.plugin} skipped: ${result.error}`);
  }
  return { started, stop: () => stopUnifiedPluginServers(servers) };
}

export async function stopUnifiedPluginServers(servers?: UnifiedPluginServer[]): Promise<void> {
  const names = servers?.map((server) => server.plugin) ?? [...running.keys()];
  await Promise.all(names.map((name) => stopServer(name)));
}

export function unifiedPluginServerRoutes(servers: UnifiedPluginServer[]) {
  const configs = serverMap(servers);
  return new Elysia({ name: 'unified:plugin-server-routes' })
    .get('/api/plugins/:name/server/health', async ({ params, set }) => {
      const config = configs.get(params.name);
      if (!config) return sendFailure(set, failure(params.name, 404, 'plugin server not found'));
      const result = await ensureServer(config);
      if (!result.ok) return sendFailure(set, result);
      if (!result.health.healthy) set.status = 502;
      return {
        ok: result.health.healthy,
        plugin: result.running.config.plugin,
        healthy: result.health.healthy,
        status: result.health.status,
        healthPath: result.health.healthPath,
        routePrefix: result.running.config.routePrefix,
        startedAt: result.running.startedAt,
      };
    })
    .all('/api/plugins/:name/server/*', async ({ params, request, set }) => {
      const p = params as { name: string; '*': string };
      const config = configs.get(p.name);
      if (!config) return sendFailure(set, failure(p.name, 404, 'plugin server not found'));
      const result = await ensureServer(config);
      if (!result.ok) return sendFailure(set, result);

      const source = new URL(request.url);
      const target = new URL(`/${p['*']}`, result.running.baseUrl);
      target.search = source.search;
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.set('x-arra-plugin-name', result.running.config.plugin);
      try {
        return await fetch(target, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
          redirect: 'manual',
          duplex: 'half',
        });
      } catch (error) {
        return Response.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: 502 },
        );
      }
    });
}
