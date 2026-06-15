import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createEmbeddingProvider } from '../../../src/vector/embeddings.ts';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { proxyVectorSidecarRequest } from '../../../src/vector/proxy-manifest.ts';
import type { VectorProxyManifest } from '../../../src/vector/config.ts';

const manifest: VectorProxyManifest = {
  path: '/api/vector-db',
  targetEnv: 'TEST_VECTOR_DB_URL',
  stripPrefix: true,
  methods: ['GET', 'POST'],
};

const servers: ReturnType<typeof Bun.serve>[] = [];
const tmpDirs: string[] = [];

function startServer(handler: (req: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function proxyApp(target?: string, manifests = [manifest]) {
  const env: NodeJS.ProcessEnv = target ? { TEST_VECTOR_DB_URL: target } : {};
  return new Elysia()
    .onRequest(({ request }) => proxyVectorSidecarRequest(request, manifests, env))
    .get('/api/health', () => ({ ok: true }));
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

afterEach(() => {
  while (servers.length) servers.pop()!.stop();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  delete process.env.TEST_VECTOR_DB_URL;
});

describe('vector proxy manifest', () => {
  test('passes through to sidecar and strips the public prefix', async () => {
    const target = startServer(async (req) => Response.json({
      method: req.method,
      path: new URL(req.url).pathname + new URL(req.url).search,
      body: await req.text(),
    }));
    const app = proxyApp(target);

    const res = await app.handle(new Request('http://local/api/vector-db/collections?q=one', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-unified-proxy-target')).toBe(new URL(target).origin);
    expect(await json(res)).toEqual({
      method: 'POST',
      path: '/collections?q=one',
      body: JSON.stringify({ ok: true }),
    });
  });

  test('enforces manifest methods and reports missing target env', async () => {
    const app = proxyApp(undefined, [{ ...manifest, methods: ['GET'] }]);

    const blocked = await app.handle(new Request('http://local/api/vector-db/items', {
      method: 'POST',
    }));
    expect(blocked.status).toBe(405);
    expect(blocked.headers.get('allow')).toBe('GET');

    const missing = await app.handle(new Request('http://local/api/vector-db/items'));
    expect(missing.status).toBe(502);
    expect((await json(missing)).targetEnv).toBe('TEST_VECTOR_DB_URL');
  });

  test('unified loader registers proxy manifest for nested sidecar paths', async () => {
    const target = startServer((req) => Response.json({ path: new URL(req.url).pathname }));
    process.env.TEST_VECTOR_DB_URL = target;
    const base = mkdtempSync(join(tmpdir(), 'arra-vector-plugin-'));
    tmpDirs.push(base);
    const dir = join(base, 'vector-proxy-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), 'export function noop() { return { ok: true }; }\n');
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'vector-proxy-plugin',
      version: '1.0.0',
      entry: './index.ts',
      proxy: [{ path: '/api/plugin-vector', targetEnv: 'TEST_VECTOR_DB_URL', stripPrefix: true }],
    }));

    const runtime = await loadUnifiedPlugins({ dirs: [base] });
    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as any);
    const res = await app.handle(new Request('http://local/api/plugin-vector/collections'));

    expect(runtime.routes).toHaveLength(1);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ path: '/collections' });
  });

  test('non-matching paths fall through to local Elysia routes', async () => {
    const app = proxyApp('http://127.0.0.1:1');
    const res = await app.handle(new Request('http://local/api/health'));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe('embedder capability', () => {
  test('default provider is none and fails fast for FTS fallback', async () => {
    const provider = createEmbeddingProvider();

    expect(provider.name).toBe('none');
    await expect(provider.embed(['hello'])).rejects.toThrow(/FTS5 fallback/);
  });

  test('local backend aliases to Ollama without network work at construction', () => {
    const provider = createEmbeddingProvider('local', 'nomic-embed-text');

    expect(provider.name).toBe('ollama');
    expect(provider.dimensions).toBe(768);
  });

  test('remote backend posts texts and accepts embeddings arrays', async () => {
    let payload: any = null;
    const target = startServer(async (req) => {
      payload = await req.json();
      return Response.json({ embeddings: [[1, 2], [3, 4]] });
    });
    const provider = createEmbeddingProvider('remote', 'bge-m3', { url: target, dimensions: 2 });

    const vectors = await provider.embed(['alpha', 'beta'], 'query');

    expect(vectors).toEqual([[1, 2], [3, 4]]);
    expect(payload).toMatchObject({ texts: ['alpha', 'beta'], type: 'query', model: 'bge-m3' });
    expect(provider.dimensions).toBe(2);
  });

  test('remote backend reports graceful FTS fallback on HTTP failure', async () => {
    const target = startServer(() => new Response('down', { status: 503 }));
    const provider = createEmbeddingProvider('remote', 'bge-m3', { url: target });

    await expect(provider.embed(['alpha'])).rejects.toThrow(/Remote embedder unavailable.*FTS5 fallback/);
  });
});
