import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const root = join(tmpdir(), `session-summary-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');

mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { sessionsRoutes } = await import('../../../src/routes/sessions/index.ts');
const { MAX_SUMMARY_CHARS } = await import('../../../src/routes/sessions/model.ts');
const { createTenantFetch, DEFAULT_TENANT_ID, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function post(id: string, body: unknown, tenantId?: string) {
  const headers = {
    'content-type': 'application/json',
    ...(tenantId ? { [TENANT_HEADER]: tenantId } : {}),
  };
  return createTenantFetch((request) => sessionsRoutes.handle(request))(new Request(`http://local/api/session/${id}/summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  restore('ORACLE_REPO_ROOT', savedRepoRoot);
  dbMod.resetDefaultDatabaseForTests();
  rmSync(root, { recursive: true, force: true });
});

describe('session summary HTTP route', () => {
  test('rejects an empty summary before writing a document', async () => {
    const res = await post('empty-session', { summary: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing required field: summary' });
  });

  test('rejects summaries over the configured maximum before writing a document', async () => {
    const sessionId = `too-long-${Date.now()}`;
    const res = await post(sessionId, { summary: 'x'.repeat(MAX_SUMMARY_CHARS + 1) });
    const body = await res.json() as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body.error).toBe(`summary exceeds max length (${MAX_SUMMARY_CHARS} chars)`);
    const row = dbMod.db.select().from(dbMod.oracleDocuments)
      .where(eq(dbMod.oracleDocuments.id, `session-summary_${sessionId}`))
      .get();
    expect(row).toBeUndefined();
  });

  test('returns a conflict instead of throwing when a summary file already exists', async () => {
    const sessionId = `duplicate-${Date.now()}`;
    const first = await post(sessionId, { summary: 'First duplicate summary.' });
    const second = await post(sessionId, { summary: 'Second duplicate summary.' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Session summary already exists' });
  });

  test('separates identical session summary ids by active tenant', async () => {
    const sessionId = `shared-session-${Date.now()}`;
    const tenantA = `session-a-${Date.now()}`;
    const tenantB = `session-b-${Date.now()}`;
    const defaultRes = await post(sessionId, { summary: 'Default tenant summary.' });
    const tenantARes = await post(sessionId, { summary: 'Tenant A summary.', oracle: 'codex' }, tenantA);
    const tenantBRes = await post(sessionId, { summary: 'Tenant B summary.', oracle: 'codex' }, tenantB);
    const bodies = await Promise.all([defaultRes, tenantARes, tenantBRes].map(async (res) => await res.json() as Record<string, any>));

    expect([defaultRes.status, tenantARes.status, tenantBRes.status]).toEqual([201, 201, 201]);
    expect(bodies.map((body) => body.tenant_id)).toEqual([DEFAULT_TENANT_ID, tenantA, tenantB]);
    expect(new Set(bodies.map((body) => body.learning_id)).size).toBe(3);
    expect(bodies[0].source_file).toBe(`ψ/memory/session-summaries/${sessionId}.md`);
    expect(bodies[1].source_file).toBe(`ψ/memory/session-summaries/${tenantA}/${sessionId}.md`);
    expect(bodies[2].source_file).toBe(`ψ/memory/session-summaries/${tenantB}/${sessionId}.md`);

    const ids = bodies.map((body) => String(body.learning_id));
    const docs = dbMod.db.select({ id: dbMod.oracleDocuments.id, tenantId: dbMod.oracleDocuments.tenantId })
      .from(dbMod.oracleDocuments)
      .where(inArray(dbMod.oracleDocuments.id, ids))
      .all();
    const logs = dbMod.db.select({ documentId: dbMod.learnLog.documentId, tenantId: dbMod.learnLog.tenantId })
      .from(dbMod.learnLog)
      .where(inArray(dbMod.learnLog.documentId, ids))
      .all();
    const ftsRows = ids.map((id) => dbMod.sqlite.prepare('SELECT id FROM oracle_fts WHERE id = ?').get(id));

    expect(docs).toHaveLength(3);
    expect(logs).toHaveLength(3);
    expect(docs.map((row) => row.tenantId).sort()).toEqual([DEFAULT_TENANT_ID, tenantA, tenantB].sort());
    expect(logs.map((row) => row.tenantId).sort()).toEqual([DEFAULT_TENANT_ID, tenantA, tenantB].sort());
    expect(ftsRows.every(Boolean)).toBe(true);
  });

  test('persists a valid session summary as a learning document', async () => {
    const sessionId = `session-${Date.now()}`;
    const res = await post(sessionId, { summary: 'Session captured useful route test coverage.', oracle: 'codex' });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.source_file).toBe(`ψ/memory/session-summaries/${sessionId}.md`);
    expect(body.learning_id).toBe(`session-summary_${sessionId}`);

    const row = dbMod.db.select({ createdBy: dbMod.oracleDocuments.createdBy })
      .from(dbMod.oracleDocuments)
      .where(eq(dbMod.oracleDocuments.id, body.learning_id))
      .get();
    expect(row?.createdBy).toBe('session_summary');
  });
});
