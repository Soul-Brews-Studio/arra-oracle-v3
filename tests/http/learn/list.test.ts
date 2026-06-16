import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function restoreDbPath() {
  return savedDbPath
    ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-learn-list-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createLearnCrudRoutes, createLearnListRoutes } = await import('../../../src/routes/learn/index.ts');

function app() {
  return new Elysia({ prefix: '/api' }).use(createLearnListRoutes()).use(createLearnCrudRoutes());
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
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/learn', () => {
  test('lists active learn entries with content and hides soft-deleted rows', async () => {
    const active = await call('POST', '/api/learn', {
      pattern: 'Visible learn entry\n\nThis content should appear in the frontend.',
      concepts: ['learn', 'visible'],
      source: 'list-test',
    });
    const deleted = await call('POST', '/api/learn', {
      pattern: 'Deleted learn entry',
      concepts: ['learn', 'deleted'],
      source: 'list-test',
    });
    await call('DELETE', `/api/learn/${deleted.json.id}`);

    const listed = await call('GET', '/api/learn');
    expect(listed.status).toBe(200);
    expect(listed.json.total).toBe(1);
    expect(listed.json.items).toHaveLength(1);
    expect(listed.json.items[0]).toMatchObject({
      id: active.json.id,
      title: 'Visible learn entry',
      concepts: ['learn', 'visible'],
    });
    expect(listed.json.items[0].content).toContain('This content should appear in the frontend.');
    expect(listed.json.items[0].content).not.toContain('title: Visible learn entry');
  });
});
