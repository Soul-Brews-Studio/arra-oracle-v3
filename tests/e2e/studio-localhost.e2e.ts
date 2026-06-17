import { expect, test, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOSTED_STUDIO = 'https://god.buildwithoracle.com';
const DEFAULT_BACKEND = 'localhost:47778';
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OMIT_HEADERS = new Set(['connection', 'content-encoding', 'content-length', 'keep-alive', 'transfer-encoding']);

type FrontendServer = { baseUrl: string; output: string[]; process: ChildProcessWithoutNullStreams };
let frontend: FrontendServer;

test.beforeAll(async () => { frontend = await startFrontend(); });
test.afterAll(async () => { await stopFrontend(frontend); });

async function mirrorHostedStudio(page: Page): Promise<void> {
  await page.route(`${HOSTED_STUDIO}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const upstream = await fetch(`${frontend.baseUrl}${requestUrl.pathname}${requestUrl.search}`);
    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => { if (!OMIT_HEADERS.has(key.toLowerCase())) headers[key] = value; });
    await route.fulfill({ status: upstream.status, headers, body: Buffer.from(await upstream.arrayBuffer()) });
  });
}

function apiBody(path: string): unknown {
  if (path === '/api/menu') return { items: [] };
  if (path === '/api/plugins') return { dir: '/tmp/plugins', plugins: [] };
  if (path === '/api/stats') return { total_docs: 1, vector: { enabled: true, count: 1 } };
  if (path === '/api/v1/vector/providers') return { providers: [] };
  if (path === '/api/v1/vector/config') return { config: { collections: { docs: { enabled: true } } }, doc_counts: { docs: 1 } };
  if (path === '/api/v1/metrics') return { uptime: 1, requestCount: 1, avgResponseMs: 1, activeConnections: 0, memoryUsage: {} };
  return { status: 'ok', server: 'oracle-test', version: 'test', port: 47778 };
}

async function mockLocalBackend(page: Page) {
  const seen = { urls: [] as string[] };
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    seen.urls.push(`${request.method()} ${request.url()}`);
    const headers = {
      'access-control-allow-headers': 'accept,content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-origin': HOSTED_STUDIO,
      'access-control-allow-private-network': 'true',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    await route.fulfill({ status: 200, headers, json: apiBody(url.pathname) });
  };
  await page.route('http://localhost:47778/api/**', handler);
  await page.route('http://127.0.0.1:47778/api/**', handler);
  return seen;
}

async function installFetchProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    (window as any).__oracleFetchCalls = [];
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      (window as any).__oracleFetchCalls.push({ targetAddressSpace: (init as any)?.targetAddressSpace, url });
      return originalFetch(input, init);
    };
  });
}

async function sawPnaFetch(page: Page, url: string): Promise<boolean> {
  return page.evaluate((target) => (window as any).__oracleFetchCalls
    ?.some((call: any) => call.url === target && call.targetAddressSpace === 'local') ?? false, url);
}

test.describe('hosted Studio direct-local Oracle connection', () => {
  test.beforeEach(async ({ page }) => {
    await mirrorHostedStudio(page);
    await installFetchProbe(page);
  });

  test('HTTPS Studio defaults API calls to http://localhost:47778 with PNA fetch option', async ({ page }) => {
    const seen = await mockLocalBackend(page);

    await page.goto(HOSTED_STUDIO);
    await expect.poll(() => seen.urls).toContain(`GET http://${DEFAULT_BACKEND}/api/health`);
    await expect.poll(() => sawPnaFetch(page, `http://${DEFAULT_BACKEND}/api/health`)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Control Surface' })).toBeVisible();
  });

  test('?host= overrides, persists, and cleans the browser URL', async ({ page }) => {
    const override = '127.0.0.1:47778';
    const seen = await mockLocalBackend(page);

    await page.goto(`${HOSTED_STUDIO}/?host=${override}&pane=menu`);
    await expect.poll(() => seen.urls).toContain(`GET http://${override}/api/health`);

    const url = new URL(page.url());
    expect(url.searchParams.has('host')).toBe(false);
    expect(url.searchParams.get('pane')).toBe('menu');
    expect(await page.evaluate(() => localStorage.getItem('oracle.host'))).toBe(override);
  });
});

async function startFrontend(): Promise<FrontendServer> {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const proc = spawn('bun', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: join(REPO_ROOT, 'frontend'),
    env: { ...process.env, CI: '1' },
  });
  proc.stdout.on('data', (chunk) => output.push(String(chunk)));
  proc.stderr.on('data', (chunk) => output.push(String(chunk)));
  await waitForFrontend(baseUrl, proc, output);
  return { baseUrl, output, process: proc };
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('missing port')));
    });
  });
}

async function waitForFrontend(baseUrl: string, proc: ChildProcessWithoutNullStreams, output: string[]): Promise<void> {
  const deadline = Date.now() + 15_000;
  let last = '';
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`frontend exited (${proc.exitCode})\n${output.join('')}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`frontend did not become ready: ${last}\n${output.join('')}`);
}

async function stopFrontend(server?: FrontendServer): Promise<void> {
  if (!server || server.process.exitCode !== null) return;
  server.process.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.process.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)).then(() => server.process.kill('SIGKILL')),
  ]);
}
