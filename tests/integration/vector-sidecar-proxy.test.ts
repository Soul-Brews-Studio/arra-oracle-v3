import { afterAll, describe, expect, test } from 'bun:test';
import type { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-wire-'));
const backendData = path.join(tmp, 'backend');
const sidecarData = path.join(tmp, 'sidecar');
const repoRoot = path.join(tmp, 'repo');
fs.mkdirSync(repoRoot, { recursive: true });

const originalEnv = snapshotEnv([
  'ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_REPO_ROOT', 'ORACLE_VECTOR_DB',
  'ORACLE_PROXY_VECTOR_URL', 'ORACLE_VECTOR_ENABLED', 'ORACLE_EMBEDDER',
  'ORACLE_EMBEDDER_URL', 'ORACLE_EMBEDDING_DIMENSIONS', 'ARRA_FORCE_AVX',
  'VECTOR_URL', 'ORACLE_VECTOR_DB_PATH', 'ARRA_API_TOKEN', 'ARRA_API_KEY',
  'ORACLE_TENANT_TOKENS', 'ORACLE_TENANT_API_KEYS', 'ORACLE_GATEWAY_HOT_RELOAD',
]);

process.env.ORACLE_DATA_DIR = backendData;
process.env.ORACLE_DB_PATH = path.join(backendData, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_VECTOR_DB = 'proxy';
process.env.ORACLE_PROXY_VECTOR_URL = 'http://127.0.0.1:1';
process.env.ORACLE_VECTOR_ENABLED = '1';
process.env.ARRA_FORCE_AVX = '0';
delete process.env.VECTOR_URL;
delete process.env.ORACLE_VECTOR_DB_PATH;
delete process.env.ARRA_API_TOKEN;
delete process.env.ARRA_API_KEY;
delete process.env.ORACLE_TENANT_TOKENS;
delete process.env.ORACLE_TENANT_API_KEYS;
process.env.ORACLE_GATEWAY_HOT_RELOAD = '0';

const { db, sqlite, oracleDocuments, closeDb, resetDefaultDatabaseForTests } = await import('../../src/db/index.ts');
resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { createApp } = await import('../../src/server.ts');
const { proxyToolCall } = await import('../../src/mcp/http-proxy.ts');
const { loadUnifiedPlugins } = await import('../../src/plugins/unified-loader.ts');
const { closeCachedVectorStores } = await import('../../src/vector/factory.ts');

describe('backend to vector sidecar wiring', () => {
  test('createApp search reaches bun run vector:proxy through proxy adapter', async () => {
    const sidecar = await startSidecar();
    try {
      await seedWirePath(sidecar.url);

      const app = await createBackendApp();
      const response = await app.handle(new Request(
        'http://backend.local/api/search?q=sidecar+wiring&type=learning&limit=5&mode=vector',
      ));
      const result = await response.json() as { vectorAvailable?: boolean; results?: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      expect(result.vectorAvailable).toBe(true);
      expect(result.results?.map((item) => item.id)).toContain('wire-doc');
      expect(result.results?.[0]).toMatchObject({ source: 'vector', source_file: 'docs/wire.md' });
    } finally {
      await sidecar.stop();
    }
  });

  test('MCP oracle_search proxies through createApp and returns sidecar vector results', async () => {
    const sidecar = await startSidecar();
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      await seedWirePath(sidecar.url);
      const app = await createBackendApp();
      server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) });

      const tool = await proxyToolCall(String(server.url).replace(/\/$/, ''), 'oracle_search', {
        query: 'sidecar wiring',
        type: 'learning',
        limit: 5,
        mode: 'vector',
      });
      const result = parseToolJson(tool);

      expect(result.vectorAvailable).toBe(true);
      expect(result.results?.map((item) => item.id)).toContain('wire-doc');
      expect(result.results?.[0]?.source_file).toBe('docs/wire.md');
      expect(['vector', 'hybrid']).toContain(result.results?.[0]?.source);
    } finally {
      await server?.stop(true);
      await sidecar.stop();
    }
  });
});


async function createBackendApp(): Promise<Elysia> {
  const unifiedPlugins = await loadUnifiedPlugins({ dirs: [] });
  return createApp({ unifiedPlugins, dataDir: backendData, vectorUrl: '' }) as unknown as Elysia;
}

function writeBackendVectorConfig(endpoint: string) {
  fs.mkdirSync(backendData, { recursive: true });
  fs.writeFileSync(path.join(backendData, 'vector-server.json'), JSON.stringify({
    version: '1.0',
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    dataPath: sidecarData,
    embeddingEndpoint: '',
    collections: {
      'bge-m3': {
        collection: 'oracle_knowledge_bge_m3',
        model: 'bge-m3',
        provider: 'none',
        adapter: 'proxy',
        endpoint,
        primary: true,
      },
    },
  }), 'utf8');
}

function seedBackendDoc() {
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id: 'wire-doc',
    type: 'learning',
    sourceFile: 'docs/wire.md',
    concepts: JSON.stringify(['vector', 'sidecar']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: null,
  }).run();
}

async function seedWirePath(sidecarUrl: string) {
  await closeCachedVectorStores();
  process.env.ORACLE_PROXY_VECTOR_URL = sidecarUrl;
  writeBackendVectorConfig(sidecarUrl);
  seedBackendDoc();
  await fetch(`${sidecarUrl}/vectors/collection`, { method: 'DELETE' });
  const add = await fetch(`${sidecarUrl}/vectors/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documents: [{
        id: 'wire-doc',
        document: 'Sidecar vector proxy wiring proof',
        metadata: { type: 'learning', source_file: 'docs/wire.md' },
        vector: [0.9, 0.1, 0.1],
      }],
    }),
  });
  expect(add.status).toBe(200);
}

async function startSidecar() {
  const embedder = fixedEmbedder();
  const port = await freePort();
  const proc = Bun.spawn(['bun', 'run', 'vector:proxy'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORACLE_DATA_DIR: sidecarData,
      ORACLE_DB_PATH: path.join(sidecarData, 'oracle.db'),
      VECTOR_PORT: String(port),
      ORACLE_VECTOR_DB: 'lancedb',
      ORACLE_EMBEDDER: 'remote',
      ORACLE_EMBEDDER_URL: `${embedder.url}embed`,
      ORACLE_EMBEDDING_DIMENSIONS: '3',
      ARRA_FORCE_AVX: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForOk(`${url}/health`);
  } catch (error) {
    proc.kill();
    embedder.stop(true);
    await proc.exited.catch(() => undefined);
    throw error;
  }
  return {
    url,
    stop: async () => {
      proc.kill();
      embedder.stop(true);
      await proc.exited.catch(() => undefined);
    },
  };
}

function parseToolJson(tool: Awaited<ReturnType<typeof proxyToolCall>>) {
  expect(tool).not.toBeNull();
  expect(tool?.isError).toBeUndefined();
  return JSON.parse(tool!.content[0].text) as { vectorAvailable?: boolean; results?: Array<Record<string, unknown>> };
}

function fixedEmbedder() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/embed') return new Response('not found', { status: 404 });
      const body = await request.json() as { texts?: unknown[]; input?: unknown[] };
      const count = (body.texts ?? body.input ?? []).length;
      return Response.json({ embeddings: Array.from({ length: count }, () => [0.9, 0.1, 0.1]) });
    },
  });
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitForOk(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function snapshotEnv(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

afterAll(() => {
  closeDb();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});
