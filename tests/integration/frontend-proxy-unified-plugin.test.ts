import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { REPO_ROOT, startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

type Spawned = ReturnType<typeof Bun.spawn>;

type FrontendServer = {
  baseUrl: string;
  process: Spawned;
  stdout: Promise<string>;
  stderr: Promise<string>;
  stop: () => Promise<void>;
};

let backend: SmokeServer | null = null;
let frontend: FrontendServer | null = null;

beforeAll(async () => {
  backend = await startSmokeServer({ name: 'frontend-proxy-unified', withPlugin: true });
  frontend = await startFrontend(backend.baseUrl);
});

afterAll(async () => {
  await frontend?.stop();
  await backend?.stop();
});

test('React frontend proxy returns unified plugin menu and plugin registry data', async () => {
  expect(frontend).not.toBeNull();
  const baseUrl = frontend!.baseUrl;

  const menuResponse = await fetch(`${baseUrl}/api/menu`);
  expect(menuResponse.status).toBe(200);
  const menu = await menuResponse.json() as { items: Array<Record<string, unknown>> };
  const menuItem = menu.items.find((item) => item.label === 'Smoke Orbit');
  expect(menuItem).toMatchObject({ path: '/smoke-orbit', source: 'plugin' });

  const pluginsResponse = await fetch(`${baseUrl}/api/plugins`);
  expect(pluginsResponse.status).toBe(200);
  const body = await pluginsResponse.json() as { plugins: Array<Record<string, unknown>> };
  const plugin = body.plugins.find((entry) => entry.name === 'smoke-orbit');
  expect(plugin).toMatchObject({ name: 'smoke-orbit', description: 'Smoke fixture plugin' });
  expect(plugin?.server).toMatchObject({ command: 'bun', healthPath: '/health', autostart: false });
});

async function startFrontend(proxyTarget: string): Promise<FrontendServer> {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: join(REPO_ROOT, 'frontend'),
    env: { ...process.env, FRONTEND_PROXY_TARGET: proxyTarget, CI: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();

  try {
    await waitForFrontend(baseUrl, proc);
  } catch (error) {
    proc.kill('SIGTERM');
    await proc.exited.catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await stdout}\n${await stderr}`);
  }

  return { baseUrl, process: proc, stdout, stderr, stop: () => stopFrontend(proc) };
}

async function reservePort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') });
  const { port } = server;
  await server.stop(true);
  if (!port) throw new Error('failed to reserve frontend port');
  return port;
}

async function waitForFrontend(baseUrl: string, proc: Spawned): Promise<void> {
  let exited = false;
  proc.exited.then(() => { exited = true; }).catch(() => { exited = true; });
  const deadline = Date.now() + 15_000;
  let last = '';
  while (Date.now() < deadline) {
    if (exited) throw new Error('frontend exited before becoming ready');
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`frontend did not become ready: ${last}`);
}

async function stopFrontend(proc: Spawned): Promise<void> {
  proc.kill('SIGTERM');
  const timedOut = Symbol('timeout');
  const result = await Promise.race([proc.exited.catch(() => 0), sleep(1500).then(() => timedOut)]);
  if (result === timedOut) {
    proc.kill('SIGKILL');
    await proc.exited.catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
