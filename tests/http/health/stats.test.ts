import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
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
