import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
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

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function post(id: string, body: unknown) {
  return sessionsRoutes.handle(new Request(`http://local/api/session/${id}/summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
