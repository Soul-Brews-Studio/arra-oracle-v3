import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createErrorMiddleware } from '../../../src/middleware/errors.ts';
import { eq } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const restoreDbPath = savedDbPath
  ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
const root = join(tmpdir(), `arra-learn-crud-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createLearnCrudRoutes } = await import('../../../src/routes/learn/index.ts');

function app() {
  return new Elysia({ prefix: '/api' })
    .use(createErrorMiddleware(() => undefined))
    .use(createLearnCrudRoutes());
}

function versionedHandle(request: Request) {
  return createApiVersionedFetch((next) => app().handle(next))(request);
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
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('POST/GET/PUT/DELETE /api/learn', () => {
  test('rejects malformed JSON body as 400, not 500', async () => {
    const res = await app().handle(new Request('http://local/api/learn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Bad Request', code: 400 });
    expect(body.details.message).toBe('Bad Request');
    expect(typeof body.details.correlationId).toBe('string');
  });

  test('rejects malformed JSON on versioned route with 400 contract', async () => {
    const res = await versionedHandle(new Request('http://local/api/v1/learn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Bad Request', code: 400 });
    expect(body.details.message).toBe('Bad Request');
    expect(typeof body.details.correlationId).toBe('string');
  });

  test('creates, reads, updates, and soft-deletes a learning through Drizzle rows', async () => {
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

    const deleted = await call('DELETE', `/api/learn/${created.json.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.json).toMatchObject({ id: created.json.id, deleted: 'soft' });
    expect(deleted.json.supersededAt).toBeGreaterThan(0);

    const afterDelete = dbMod.db.select().from(dbMod.oracleDocuments)
      .where(eq(dbMod.oracleDocuments.id, created.json.id)).get();
    expect(afterDelete?.supersededAt).toBe(deleted.json.supersededAt);
    expect(afterDelete?.supersededReason).toBe('soft-deleted via DELETE /api/learn/:id');

    const stillReadable = await call('GET', `/api/learn/${created.json.id}`);
    expect(stillReadable.status).toBe(200);
    expect(stillReadable.json.supersededAt).toBe(deleted.json.supersededAt);
  });
});
