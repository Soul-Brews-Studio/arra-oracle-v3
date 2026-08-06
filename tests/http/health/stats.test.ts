import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { createStatsEndpoint } from '../../../src/routes/health/stats.ts';
import { clearEmbedderRuntimeStatusForTests, setEmbedderRuntimeStatus } from '../../../src/vector/embedder-config.ts';
import { db, getSetting, oracleDocuments, setSetting, settings } from '../../../src/db/index.ts';

const savedTimeout = process.env.ORACLE_CHROMA_TIMEOUT;
const docId = `stats-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = Date.now();
const savedVaultRepo = getSetting('vault_repo');
process.env.ORACLE_CHROMA_TIMEOUT = '1';
setSetting('vault_repo', 'coverage-vault');

db.insert(oracleDocuments).values({
  id: docId,
  type: 'learning',
  sourceFile: `ψ/memory/learnings/${docId}.md`,
  concepts: '[]',
  createdAt: now,
  updatedAt: now,
  indexedAt: now,
}).run();

afterAll(() => {
  db.delete(oracleDocuments).where(eq(oracleDocuments.id, docId)).run();
  if (savedVaultRepo === null) db.delete(settings).where(eq(settings.key, 'vault_repo')).run();
  else setSetting('vault_repo', savedVaultRepo);
  if (savedTimeout === undefined) delete process.env.ORACLE_CHROMA_TIMEOUT;
  else process.env.ORACLE_CHROMA_TIMEOUT = savedTimeout;
  clearEmbedderRuntimeStatusForTests();
});

test('GET /api/stats merges document counts, vector summary, and vault setting', async () => {
  const app = createHealthRoutes();
  const res = await app.handle(new Request('http://local/api/stats'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.total).toBeGreaterThanOrEqual(1);
  expect(body.by_type.learning).toBeGreaterThanOrEqual(1);
  expect(body.vector).toMatchObject({ collection: expect.any(String) });
  expect(body.vault_repo).toBe('coverage-vault');
});

test('GET /api/stats surfaces degraded embedder reason', async () => {
  setEmbedderRuntimeStatus({
    status: 'degraded', provider: 'ollama', source: 'auto-default', explicit: false,
    reason: 'ECONNREFUSED 127.0.0.1:11434', checkedAt: 'now',
  });
  try {
    const app = new Elysia({ prefix: '/api' }).use(createStatsEndpoint({
      vectorStats: async () => ({ vector: { enabled: true, count: 0, collection: 'oracle_knowledge' }, vectors: [] }),
    }));
    const body = await (await app.handle(new Request('http://local/api/stats'))).json() as Record<string, any>;

    expect(body.vector_status).toBe('degraded');
    expect(body.vector_reason).toBe('ECONNREFUSED 127.0.0.1:11434');
    expect(body.embedder_provider).toBe('ollama');
  } finally {
    clearEmbedderRuntimeStatusForTests();
  }
});
