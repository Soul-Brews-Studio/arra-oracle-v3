import { afterEach, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { proxyVectorSidecarRequest } from '../../src/vector/proxy-manifest.ts';
import type { VectorProxyManifest } from '../../src/vector/config.ts';

export const manifest: VectorProxyManifest = {
  path: '/api/vector-db',
  targetEnv: 'TEST_VECTOR_DB_URL',
  stripPrefix: true,
  methods: ['GET', 'POST'],
};

const servers: ReturnType<typeof Bun.serve>[] = [];
const tmpDirs: string[] = [];
const envKeys = new Set<string>([
  'TEST_VECTOR_DB_URL',
  'TEST_UNIFIED_PROXY_URL',
  'VECTOR_DB_URL',
  'ORACLE_EMBEDDER',
  'ORACLE_EMBEDDER_BACKEND',
  'ORACLE_EMBEDDER_URL',
  'ORACLE_REMOTE_EMBEDDING_URL',
  'ORACLE_EMBEDDER_TIMEOUT_MS',
  'ORACLE_EMBEDDING_PROVIDER',
  'ORACLE_EMBEDDING_MODEL',
  'ORACLE_EMBEDDING_DIMENSIONS',
  'ORACLE_EMBEDDER_CHAIN',
  'ORACLE_EMBEDDING_FALLBACK_CHAIN',
  'ORACLE_VECTOR_DB',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
]);

export function startServer(handler: (req: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

export function proxyApp(target?: string, manifests = [manifest]) {
  const env: NodeJS.ProcessEnv = target ? { TEST_VECTOR_DB_URL: target } : {};
  return new Elysia()
    .onRequest(({ request }) => proxyVectorSidecarRequest(request, manifests, env))
    .get('/api/health', () => ({ ok: true }));
}

export async function json(res: Response) {
  return JSON.parse(await res.text());
}

export function tempDir(prefix = 'arra-vector-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

export function pluginFixture(manifestBody: unknown): string {
  const base = tempDir('arra-vector-plugin-');
  const dir = join(base, 'vector-proxy-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export function noop() { return { ok: true }; }\n');
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifestBody));
  return base;
}

export function trackEnv(key: string, value: string) {
  envKeys.add(key);
  process.env[key] = value;
}

export function clearVectorEnv() {
  for (const key of envKeys) delete process.env[key];
}

beforeEach(() => {
  clearVectorEnv();
});

afterEach(() => {
  while (servers.length) servers.pop()!.stop();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  clearVectorEnv();
});
