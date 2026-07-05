import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, runWithTenant, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createVectorSearchEndpoint } from '../../../src/routes/vector/search.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-entity-boost-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const linked = `boost-linked-${stamp}`;
const plain = `boost-plain-${stamp}`;
const otherTenant = `boost-other-${stamp}`;

let dbModule: typeof import('../../../src/db/index.ts');
let replaceEntityLinks: typeof import('../../../src/search/entity-ranking.ts').replaceEntityLinks;
let setScopedSetting: typeof import('../../../src/db/scoped-settings.ts').setScopedSetting;
let fetcher: (request: Request) => Response | Promise<Response>;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  ({ replaceEntityLinks } = await import('../../../src/search/entity-ranking.ts'));
  ({ setScopedSetting } = await import('../../../src/db/scoped-settings.ts'));
  insertDoc(linked, tenantA, 6, Date.now());
  insertDoc(plain, tenantA, 0, undefined);
  insertDoc(otherTenant, tenantB, 20, Date.now());
  replaceEntityLinks(dbModule.sqlite, { documentId: linked, tenantId: tenantA, content: 'Alpha Project launch', concepts: [] });
  replaceEntityLinks(dbModule.sqlite, { documentId: otherTenant, tenantId: tenantB, content: 'Alpha Project leak', concepts: [] });
  runWithTenant(tenantA, () => setScopedSetting('vector.entity_aliases', JSON.stringify({ AP: 'Alpha Project' })));
  runWithTenant(tenantB, () => {
    setScopedSetting('vector.entity_boost_cap', '9');
    setScopedSetting('vector.entity_aliases', JSON.stringify({ BETA: 'Alpha Project' }));
  });

  const app = new Elysia({ prefix: '/api' }).use(createVectorSearchEndpoint({
    getModels: () => ({ 'bge-m3': {} }),
    getStore: () => ({ connect: mock(async () => {}), ensureCollection: mock(async () => {}), close: mock(async () => {}), query: mock(vectorResult) }),
  }));
  fetcher = createTenantFetch(createApiVersionedFetch((request) => app.handle(request)));
});

function insertDoc(id: string, tenantId: string, usageCount: number, lastAccessedAt: number | undefined) {
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id, tenantId, type: 'learning', sourceFile: `ψ/entities/${id}.md`, concepts: JSON.stringify(['alpha']),
    createdAt: now - 86_400_000, updatedAt: now, indexedAt: now, project: 'entity-boost', createdBy: 'entity-boost-test',
    usageCount, lastAccessedAt,
  }).run();
}

async function vectorResult(): Promise<VectorQueryResult> {
  return {
    ids: [plain, linked, otherTenant],
    documents: ['plain AP candidate', 'linked AP candidate', 'other tenant AP candidate'],
    distances: [0, 10, 10],
    metadatas: [
      { type: 'learning', tenant_id: tenantA, source_file: `ψ/entities/${plain}.md`, concepts: ['alpha'] },
      { type: 'learning', tenant_id: tenantA, source_file: `ψ/entities/${linked}.md`, concepts: ['alpha'] },
      { type: 'learning', tenant_id: tenantB, source_file: `ψ/entities/${otherTenant}.md`, concepts: ['alpha'] },
    ],
  };
}

function request(tenantId: string, q = 'AP rollout') {
  return fetcher(new Request(`http://local/api/v1/vector/search?q=${encodeURIComponent(q)}&limit=10`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true });
});

describe('vector entity boost', () => {
  test('boosts tenant-local entity aliases and interacts with heat/confidence ranking', async () => {
    const res = await request(tenantA);
    const body = await res.json() as { results: Array<Record<string, any>>; filters: { metadata: Record<string, string> } };

    expect(res.status).toBe(200);
    expect(body.filters.metadata).toEqual({ tenant_id: tenantA });
    expect(body.results.map((item) => item.id)).toEqual([linked, plain]);
    expect(body.results[0].entity_matches).toContain('Alpha Project');
    expect(body.results[0].entity_boost).toMatchObject({ factor: 1.5, cap: 1.5 });
    expect(body.results[0].entity_boost.heat).toBeGreaterThan(0);
    expect(body.results[0].score).toBeGreaterThan(body.results[1].score);
  });

  test('keeps aliases tenant-isolated and clamps configured boost caps to 3x', async () => {
    const noAlias = await request(tenantA, 'BETA rollout');
    const noAliasBody = await noAlias.json() as { results: Array<Record<string, any>> };
    expect(noAliasBody.results.every((item) => item.entity_boost === undefined)).toBe(true);

    const capped = await request(tenantB, 'BETA rollout');
    const cappedBody = await capped.json() as { results: Array<Record<string, any>> };
    expect(cappedBody.results).toHaveLength(1);
    expect(cappedBody.results[0].id).toBe(otherTenant);
    expect(cappedBody.results[0].entity_boost).toMatchObject({ factor: 3, cap: 3 });
  });
});
