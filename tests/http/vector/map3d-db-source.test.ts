import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Elysia } from 'elysia';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(path.join(tmpdir(), 'map3d-db-source-'));
const dbPath = path.join(root, 'oracle.db');
const tenantA = `map3d-a-${Date.now()}`;
const tenantB = `map3d-b-${Date.now()}`;

let dbMod: typeof import('../../../src/db/index.ts');
let app: Elysia;
let tenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = root;
  process.env.ORACLE_DB_PATH = dbPath;
  dbMod = await import('../../../src/db/index.ts');
  dbMod.resetDefaultDatabaseForTests(dbPath);
  const tenant = await import('../../../src/middleware/tenant.ts');
  tenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  const { map3dEndpoint } = await import('../../../src/routes/vector/map3d.ts');
  app = new Elysia({ prefix: '/api' }).use(map3dEndpoint);
  seedDoc('a-1', tenantA, 30);
  seedDoc('a-2', tenantA, 20);
  seedDoc('b-1', tenantB, 10);
});

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  rmSync(root, { recursive: true, force: true });
});

function seedDoc(id: string, tenantId: string, indexedAt: number) {
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/${tenantId}/${id}.md`,
    concepts: JSON.stringify(['map3d-db']),
    createdAt: indexedAt,
    updatedAt: indexedAt,
    indexedAt,
    project: tenantId,
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, `content ${id}`, 'map3d-db');
}

function request(tenantId: string) {
  return tenantFetch((req) => app.handle(req))(new Request('http://local/api/map3d?model=bge-m3', {
    headers: { [tenantHeader]: tenantId },
  }));
}

describe('/api/map3d DB-backed source', () => {
  test('uses tenant-scoped DB/FTS documents instead of vector collection docs', async () => {
    const res = await request(tenantA);
    const body = await res.json() as { documents: Array<{ id: string; x: number; concepts: string[] }>; total: number; pca_info: { n_vectors: number } };

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.pca_info.n_vectors).toBe(2);
    expect(body.documents.map((item) => item.id)).toEqual(['a-1', 'a-2']);
    expect(body.documents.every((item) => Number.isFinite(item.x))).toBe(true);
    expect(body.documents[0].concepts).toEqual(['map3d-db']);
  });
});
