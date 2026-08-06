import { afterAll, beforeEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmbeddingProvider } from '../../../src/vector/types.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'embedder-runtime-'));
process.env.ORACLE_DATA_DIR = root;

const dbMod = await import('../../../src/db/index.ts');
const { createHealthEndpoint } = await import('../../../src/routes/health/health.ts');
const { createStatsEndpoint } = await import('../../../src/routes/health/stats.ts');
const {
  clearEmbedderRuntimeStatusForTests,
  observeEmbeddingProvider,
  resolveEmbeddingProviderSelection,
} = await import('../../../src/vector/embedder-config.ts');

type Json = Record<string, any>;

const vectorStats = async () => ({
  vector: { enabled: true, count: 7, collection: 'oracle_knowledge_bge_m3' },
  vectors: [{ key: 'bge-m3', model: '@cf/baai/bge-m3', collection: 'oracle_knowledge_bge_m3', count: 7, enabled: true }],
});
const vectorHealth = async () => ({
  status: 'ok' as const,
  engines: [{ key: 'bge-m3', model: '@cf/baai/bge-m3', collection: 'oracle_knowledge_bge_m3', ok: true, count: 7 }],
  checked_at: new Date().toISOString(),
});

function resetDb(name: string) {
  process.env.ORACLE_DB_PATH = join(root, `${name}.db`);
  dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
}

function app() {
  return new Elysia({ prefix: '/api' })
    .use(createStatsEndpoint({ vectorStats }))
    .use(createHealthEndpoint({
      vectorHealth,
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' as const }),
      vectorRuntime: () => ({ vectorMode: 'embedded' as const }),
      pluginStatuses: async () => [],
      pluginCount: 0,
      pluginMcpToolCount: 0,
      uptimeSeconds: () => 1,
      entityCoverage: () => ({ docsIndexed: 0, docsWithEntities: 0, docsMissingEntities: 0, ratio: 1, checkedAt: new Date().toISOString() }),
    }));
}

async function getJson(path: string): Promise<Json> {
  const res = await app().handle(new Request(`http://local/api/${path}`));
  expect(res.status).toBe(200);
  return await res.json() as Json;
}

beforeEach(() => {
  resetDb(`runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  clearEmbedderRuntimeStatusForTests();
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  clearEmbedderRuntimeStatusForTests();
  if (existsSync(root)) rmSync(root, { recursive: true });
});

test('runtime embedder failure degrades health and stats, then cloudflare recovery reconnects', async () => {
  let online = false;
  const selection = resolveEmbeddingProviderSelection('cloudflare-ai');
  const provider: EmbeddingProvider = observeEmbeddingProvider({
    name: 'cloudflare-ai',
    dimensions: 3,
    async embed() {
      if (!online) throw new Error('timed out contacting mock cloudflare');
      return [[1, 2, 3]];
    },
  }, selection);

  await expect(provider.embed(['probe'], 'query')).rejects.toThrow('mock cloudflare');
  const degradedStats = await getJson('stats');
  const degradedHealth = await getJson('health');
  expect(degradedStats.vector_status).toBe('degraded');
  expect(degradedStats.vector_reason).toContain('no embedder configured/reachable');
  expect(degradedHealth.vectorStatus).toBe('degraded');
  expect(degradedHealth.vectorReason).toBe(degradedStats.vector_reason);
  expect(degradedHealth.subsystems.embedder.status).toBe('degraded');

  online = true;
  await expect(provider.embed(['probe'], 'query')).resolves.toEqual([[1, 2, 3]]);
  const restoredStats = await getJson('stats');
  const restoredHealth = await getJson('health');
  expect(restoredStats.vector_status).toBe('ok');
  expect(restoredStats.vector_reason).toBeUndefined();
  expect(restoredHealth.vectorStatus).toBe('ok');
  expect(restoredHealth.embedderStatus.status).toBe('connected');
  expect(restoredHealth.subsystems.embedder.status).toBe('healthy');
});
