import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-learn-crud-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createLearnCrudRoutes } = await import('../../../src/routes/learn/index.ts');

function app() {
  return new Elysia({ prefix: '/api' }).use(createLearnCrudRoutes());
}

async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await app().handle(new Request(`http://local${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  dbMod.db.delete(dbMod.learnLog).run();
  dbMod.db.delete(dbMod.oracleDocuments)
    .where(eq(dbMod.oracleDocuments.type, 'learning'))
    .run();
});

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  rmSync(root, { recursive: true, force: true });
});

describe('POST/GET/PUT /api/learn', () => {
  test('creates, reads, and updates a learning through Drizzle rows', async () => {
    const created = await call('POST', '/api/learn', {
      pattern: 'Learn CRUD captures route behavior',
      concepts: ['learn', 'crud'],
      source: 'http-test',
      project: 'GitHub.com/Soul-Brews-Studio/Arra-Oracle-V3',
    });
    expect(created.status).toBe(200);
    expect(created.json.success).toBe(true);
    expect(String(created.json.id).startsWith('learning_')).toBe(true);

    const stored = dbMod.db.select().from(dbMod.oracleDocuments)
      .where(eq(dbMod.oracleDocuments.id, created.json.id)).get();
    expect(stored).toMatchObject({ type: 'learning', createdBy: 'oracle_learn' });
    expect(stored?.concepts).toBe(JSON.stringify(['learn', 'crud']));
    expect(stored?.project).toBe('github.com/soul-brews-studio/arra-oracle-v3');

    const read = await call('GET', `/api/learn/${created.json.id}`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ id: created.json.id, concepts: ['learn', 'crud'] });

    const updated = await call('PUT', `/api/learn/${created.json.id}`, {
      concepts: 'learn,updated',
      origin: 'human',
      sourceFile: 'ψ/memory/learnings/updated.md',
    });
    expect(updated.status).toBe(200);
    expect(updated.json).toMatchObject({
      id: created.json.id,
      concepts: ['learn', 'updated'],
      origin: 'human',
      sourceFile: 'ψ/memory/learnings/updated.md',
    });
    expect(updated.json.updatedAt).toBeGreaterThanOrEqual(stored!.updatedAt);
  });
});
