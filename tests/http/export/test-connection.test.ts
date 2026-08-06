import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createDatabase, oracleDocuments } from '../../../src/db/index.ts';
import { createExportTestConnectionRoutes } from '../../../src/routes/export/test-connection.ts';

const root = mkdtempSync(join(tmpdir(), 'arra-export-conn-'));
const dbPath = join(root, 'oracle.db');
const connection = createDatabase(dbPath);

connection.db.insert(oracleDocuments).values({
  id: 'doc-conn-test',
  type: 'learning',
  sourceFile: 'psi/learn/conn.md',
  concepts: '["export"]',
  createdAt: 1_766_000_000_000,
  updatedAt: 1_766_000_000_000,
  indexedAt: 1_766_000_000_000,
  createdBy: 'test',
}).run();

function apiFor(app: Elysia) {
  return createApiVersionedFetch((request) => app.handle(request));
}

function post(body: Record<string, unknown>, api = fetcher) {
  return api(new Request('http://local/api/v1/export/test-connection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

let tick = 10;
const fetcher = apiFor(new Elysia({ prefix: '/api' }).use(createExportTestConnectionRoutes({
  connection,
  dbPath,
  now: () => new Date('2026-01-02T03:04:05.006Z'),
  clock: () => tick += 5,
})));

afterAll(() => {
  connection.storage.close();
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/v1/export/test-connection', () => {
  test('checks the configured Oracle database and returns exportable collections', async () => {
    const res = await post({});
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: 'connected',
      dbPath,
      checkedAt: '2026-01-02T03:04:05.006Z',
      latencyMs: 5,
    });
    expect(body.collectionCount).toBeGreaterThan(0);
    expect(body.totalRows).toBeGreaterThanOrEqual(1);
    expect(body.collections).toContainEqual(expect.objectContaining({ name: 'oracle_documents', rowCount: 1 }));
  });

  test('returns ok false when the legacy database cannot be opened', async () => {
    const failing = apiFor(new Elysia({ prefix: '/api' }).use(createExportTestConnectionRoutes({
      dbPath: join(root, 'missing.db'),
      now: () => new Date('2026-01-02T03:04:05.006Z'),
      clock: () => 20,
      openConnection: () => { throw new Error('legacy database unavailable'); },
    })));

    const res = await post({}, failing);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      status: 'error',
      checkedAt: '2026-01-02T03:04:05.006Z',
      latencyMs: 0,
      error: 'legacy database unavailable',
    });
  });
});
