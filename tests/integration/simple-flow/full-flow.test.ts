import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { createSmokeEnv, removeSmokeEnv, REPO_ROOT, type SmokeEnv } from '../../smoke/_helpers.ts';

type JsonRecord = Record<string, unknown>;
type Spawned = ReturnType<typeof Bun.spawn>;
type VectorStub = { url: string; setUp(up: boolean): void; stop(): Promise<void> };
type FlowServer = SmokeEnv & {
  baseUrl: string;
  process: Spawned;
  stdout: Promise<string>;
  stderr: Promise<string>;
  vector: VectorStub;
  stop(): Promise<void>;
};

let server: FlowServer | null = null;
const token = `simpleflow${Date.now()}`;

beforeAll(async () => {
  server = await startSimpleFlowServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

function expectRecord(value: unknown): asserts value is JsonRecord {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
}

function expectJson(response: Response, status = 200): void {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  expect(response.headers.get('x-api-version')).toBe('v1');
}

async function fetchJson(path: string, init: RequestInit = {}) {
  expect(server).not.toBeNull();
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${server!.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expectRecord(body);
  return { response, body };
}

function postJson(path: string, body: unknown) {
  return fetchJson(path, { method: 'POST', body: JSON.stringify(body) });
}

describe('Simple Mode full-flow integration', () => {
  test('boots, serves /simple, searches, learns, and degrades on vector outage', async () => {
    const simple = await fetch(`${server!.baseUrl}/simple`);
    expect(simple.status).toBe(200);
    const simpleType = simple.headers.get('content-type') ?? '';
    const simpleText = await simple.text();
    expect(simpleType).toContain('text/html');
    expect(simpleText).toContain('Simple Mode');

    const health = await fetchJson('/api/v1/health');
    expectJson(health.response);
    expect(health.body).toMatchObject({ status: 'ok', vectorMode: 'proxied' });

    const search = await fetchJson(`/api/v1/search?q=${token}&limit=2`);
    expectJson(search.response);
    expect(Array.isArray(search.body.results)).toBe(true);
    expect(search.body.results).toContainEqual(expect.objectContaining({ id: 'simple-flow-probe' }));

    const learned = await postJson('/api/v1/learn', {
      pattern: `${token} is saved through Simple Mode integration`,
      concepts: ['simple-flow', token],
      source: 'simple-flow integration test',
    });
    expectJson(learned.response);
    expect(learned.body).toMatchObject({ success: true });
    expect(typeof learned.body.id).toBe('string');

    const readBack = await fetchJson(`/api/v1/learn/${encodeURIComponent(String(learned.body.id))}`);
    expectJson(readBack.response);
    expect(readBack.body).toMatchObject({ id: learned.body.id, type: 'learning' });

    server!.vector.setUp(false);
    const degraded = await waitForDegradedHealth();
    expect(degraded.body).toMatchObject({ status: 'degraded' });
    expect(degraded.body.vectorServer).toMatchObject({ status: 'down' });
  }, 45_000);
});

async function waitForDegradedHealth() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const health = await fetchJson('/api/v1/health');
    expectJson(health.response);
    if (health.body.status === 'degraded') return health;
    await Bun.sleep(100);
  }
  throw new Error('health did not report degraded after vector outage');
}

function startVectorStub(): VectorStub {
  let up = true;
  const srv = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q') ?? '';
        return Response.json({
          results: [{ id: 'simple-flow-probe', type: 'learning', content: `${query} vector probe`, source: 'vector', score: 0.9 }],
          total: 1,
          query,
        });
      }
      if (url.pathname === '/health' || url.pathname === '/' || url.pathname === '/api/vector/health') {
        return Response.json({ status: up ? 'ok' : 'down', server: 'vector-stub' }, { status: up ? 200 : 503 });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${srv.port}`, setUp: (next) => { up = next; }, stop: () => srv.stop(true) };
}

async function startSimpleFlowServer(): Promise<FlowServer> {
  const smoke = createSmokeEnv('simple-flow');
  const vector = startVectorStub();
  Object.assign(smoke.env, {
    VECTOR_URL: vector.url,
    ARRA_PLUGIN_HOT_RELOAD: '0',
    MAW_JS_URL: 'http://127.0.0.1:1',
    ORACLE_FILE_WATCHER: '0',
    ORACLE_GATEWAY_HOT_RELOAD: '0',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ORACLE_VECTOR_HEALTH_TIMEOUT: '200',
    ORACLE_VECTOR_SERVER_HEALTH_TIMEOUT_MS: '200',
  });
  const port = await freePort();
  const env = { ...process.env, ...smoke.env, ORACLE_PORT: String(port) };
  const proc = Bun.spawn(['bun', 'src/server.ts'], { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealthy(baseUrl, proc);
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await vector.stop().catch(() => undefined);
    removeSmokeEnv(smoke.root);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await stdout}\n${await stderr}`);
  }
  return { ...smoke, baseUrl, process: proc, stdout, stderr, vector, stop: () => stopServer(proc, smoke.root, vector, stdout, stderr) };
}

async function waitForHealthy(baseUrl: string, proc: Spawned): Promise<void> {
  let exited = false;
  proc.exited.then(() => { exited = true; }).catch(() => { exited = true; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (exited) throw new Error('server exited before /api/health became ready');
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const body = await response.json().catch(() => ({})) as JsonRecord;
      if (response.ok && body.status === 'ok') return;
    } catch {}
    await Bun.sleep(150);
  }
  throw new Error('server did not become healthy');
}

async function stopServer(proc: Spawned, root: string, vector: VectorStub, stdout: Promise<string>, stderr: Promise<string>): Promise<void> {
  proc.kill('SIGTERM');
  const done = await Promise.race([proc.exited.catch(() => null), Bun.sleep(1500).then(() => 'timeout' as const)]);
  if (done === 'timeout') {
    proc.kill('SIGKILL');
    await proc.exited.catch(() => undefined);
  }
  await vector.stop().catch(() => undefined);
  await Promise.all([stdout.catch(() => ''), stderr.catch(() => '')]);
  removeSmokeEnv(root);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') return reject(new Error('failed to allocate port'));
      srv.close(() => resolve(address.port));
    });
  });
}
