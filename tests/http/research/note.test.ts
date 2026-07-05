import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const repoRoot = mkdtempSync(join(tmpdir(), 'arra-research-route-'));
process.env.ORACLE_REPO_ROOT = repoRoot;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests();
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { researchRoutes } = await import('../../../src/routes/research/index.ts');

const app = new Elysia().use(researchRoutes);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `research-tenant-${stamp}`;
const createdIds: string[] = [];

function request(body: unknown) {
  return createTenantFetch((incoming) => app.handle(incoming))(new Request('http://local/api/research/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId },
    body: JSON.stringify(body),
  }));
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  for (const id of createdIds) {
    dbMod.db.delete(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, id)).run();
    dbMod.sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
    dbMod.db.delete(dbMod.learnLog).where(eq(dbMod.learnLog.documentId, id)).run();
  }
  restore('ORACLE_REPO_ROOT', savedRepoRoot);
  rmSync(repoRoot, { recursive: true, force: true });
});

test('POST /api/research/note rejects missing titles', async () => {
  const res = await request({ title: '   ', repoEvidence: [{ path: 'src/routes/research/index.ts', summary: 'route' }] });
  const body = await res.json() as { success: boolean; error: string };

  expect(res.status).toBe(400);
  expect(body).toEqual({ success: false, error: 'oracle_research_note requires title' });
});

test('POST /api/research/note stores a tenant-scoped research learning', async () => {
  const res = await request({
    title: `Research route note ${stamp}`,
    question: 'Does the dedicated research HTTP route persist notes?',
    recommendation: 'Keep direct route-cluster coverage.',
    repo: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
    repoEvidence: [{ path: 'src/routes/research/index.ts', summary: 'POST route builds a learning.' }],
    concepts: ['coverage-gap'],
    project: 'Arra Oracle',
  });
  const body = await res.json() as { success: boolean; id: string; file: string };
  createdIds.push(body.id);

  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.id).toStartWith('learning_');
  expect(body.file).toStartWith('ψ/memory/learnings/');

  const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, body.id)).get();
  expect(row).toMatchObject({ tenantId, type: 'learning', origin: 'thor-oracle', project: 'arra oracle' });
  expect(JSON.parse(row?.concepts ?? '[]')).toEqual(expect.arrayContaining(['thor-oracle', 'stormforge', 'dev-research', 'coverage-gap']));

  const file = readFileSync(join(repoRoot, body.file), 'utf-8');
  expect(file).toContain(`Research route note ${stamp}`);
  expect(file).toContain('Keep direct route-cluster coverage.');
});
