import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-phase1-entity-eval-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = `phase1-a-${stamp}`;
const tenantB = `phase1-b-${stamp}`;
const savedEnv = {
  data: process.env.ORACLE_DATA_DIR,
  db: process.env.ORACLE_DB_PATH,
};

type Db = typeof import('../../src/db/index.ts');
type SearchBody = { results: Array<Record<string, any>> };
type AskBody = { citations: Array<{ id: string; index: number }>; sources: Array<Record<string, any>> };
type FanoutBody = { results: Array<Record<string, any>>; warnings?: string[] };
type CaseKey = 'exact' | 'alias' | 'bigram' | 'tenant' | 'stale' | 'entityOnly';

let db: Db;
let searchRoutes: { handle: (request: Request) => Response | Promise<Response> };
let askRoute: { handle: (request: Request) => Response | Promise<Response> };
let tenantHeader: string;
let createTenantFetch: typeof import('../../src/middleware/tenant.ts').createTenantFetch;
let fanoutFetch: (request: Request) => Promise<Response>;
let entityKey: (value: string) => string;

const cases = {
  exact: pair('exact', 'Valkyrie Project'),
  alias: pair('alias', 'Application Programming Interface', 'API'),
  bigram: pair('bigram', 'Redwood Bridge'),
  tenant: { anchor: `p1tenant${stamp}`, entity: 'Tenant Ghost', plain: `tenant-a-${stamp}`, linked: `tenant-b-${stamp}` },
  stale: { anchor: `p1stale${stamp}`, entity: 'Atlas Runbook', old: `stale-old-${stamp}`, current: `stale-current-${stamp}` },
  entityOnly: { anchor: `p1only${stamp}`, entity: 'Nebula Vault', candidate: `only-candidate-${stamp}`, hidden: `only-hidden-${stamp}` },
};

function pair(key: string, entity: string, queryEntity = entity) {
  return { anchor: `p1${key}${stamp}`, entity, queryEntity, plain: `${key}-plain-${stamp}`, linked: `${key}-linked-${stamp}` };
}

beforeAll(async () => {
  await import('../../src/config.ts');
  process.env.ORACLE_DATA_DIR = root;
  process.env.ORACLE_DB_PATH = path.join(root, 'oracle.db');
  db = await import('../../src/db/index.ts');
  db.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const tenant = await import('../../src/middleware/tenant.ts');
  createTenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  ({ searchRoutes } = await import('../../src/routes/search/index.ts'));
  const ask = await import('../../src/routes/ask/index.ts');
  askRoute = ask.createAskRoutes({ now: () => new Date('2026-07-05T00:00:00.000Z') });
  ({ entityKey } = await import('../../src/search/entity-ranking.ts'));
  const { createApiVersionedFetch } = await import('../../src/middleware/api-version.ts');
  const { createMemoryFanoutEndpoint } = await import('../../src/routes/memory/fanout.ts');
  fanoutFetch = createApiVersionedFetch(createTenantFetch((req) => new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => ({ eval: { collection: 'eval', model: 'eval' } }),
    connect: async () => ({ query: async (q) => fanoutResult(q) }),
  })).handle(req)));
  seed();
});

afterAll(() => {
  db?.closeDb();
  restore('ORACLE_DATA_DIR', savedEnv.data);
  restore('ORACLE_DB_PATH', savedEnv.db);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Phase 1 entity golden eval baseline', () => {
  test('current /api/search, /api/ask, and fanout capture exact and bigram entity boosts', async () => {
    for (const key of ['exact', 'bigram'] as CaseKey[]) {
      const item = cases[key] as ReturnType<typeof pair>;
      const q = `${item.queryEntity} ${item.anchor}`;
      expect(ids(await search(q))).toEqual([item.linked, item.plain]);
      const ask = await askJson(q);
      expect(ask.citations[0]).toMatchObject({ id: item.linked, index: 1 });
      expect(ask.sources[0].entityMatches).toContain(item.entity);
      expect(ids(await fanout(q))).toEqual([item.linked, item.plain]);
    }
  });

  test('acronym alias is boosted in /api/search, /api/ask, and fanout', async () => {
    const item = cases.alias;
    const q = `${item.queryEntity} ${item.anchor}`;
    expect(ids(await search(q))).toEqual([item.linked, item.plain]);
    expect((await askJson(q)).citations.map((hit) => hit.id)).toEqual([item.linked, item.plain]);
    expect(ids(await fanout(q))).toEqual([item.linked, item.plain]);
  });

  test('tenant isolation blocks cross-tenant entity matches in search, ask, and fanout', async () => {
    const q = `${cases.tenant.entity} ${cases.tenant.anchor}`;
    expect(ids(await search(q))).toEqual([cases.tenant.plain]);
    expect((await askJson(q)).citations.map((item) => item.id)).toEqual([cases.tenant.plain]);
    expect(ids(await fanout(q))).toEqual([cases.tenant.plain]);
  });

  test('asOf filters stale entity matches in search, ask, and fanout', async () => {
    const q = `${cases.stale.entity} ${cases.stale.anchor}`;
    const asOf = '2026-01-01T00:00:00.000Z';
    expect(ids(await search(q, `&asOf=${encodeURIComponent(asOf)}`))).toEqual([cases.stale.current]);
    expect((await askJson(q, { asOf })).citations.map((item) => item.id)).toEqual([cases.stale.current]);
    expect(ids(await fanout(q, `&asOf=${encodeURIComponent(asOf)}`))).toEqual([cases.stale.current]);
  });

  test('entity-only sidecar hits do not appear unless the document is already a retrieval candidate', async () => {
    const q = `${cases.entityOnly.entity} ${cases.entityOnly.anchor}`;
    expect(ids(await search(q))).toEqual([cases.entityOnly.candidate]);
    expect((await askJson(q)).citations.map((item) => item.id)).toEqual([cases.entityOnly.candidate]);
    expect(ids(await fanout(q))).toEqual([cases.entityOnly.candidate]);
  });
});

function seed() {
  for (const key of ['exact', 'alias', 'bigram'] as const) {
    const item = cases[key];
    doc(item.plain, tenantA, item.anchor);
    doc(item.linked, tenantA, item.anchor, item.entity);
  }
  doc(cases.tenant.plain, tenantA, cases.tenant.anchor);
  doc(cases.tenant.linked, tenantB, cases.tenant.anchor, cases.tenant.entity);
  doc(cases.stale.old, tenantA, cases.stale.anchor, cases.stale.entity, {
    validTime: Date.parse('2024-01-01T00:00:00.000Z'),
    supersededBy: cases.stale.current,
    supersededAt: Date.parse('2025-01-01T00:00:00.000Z'),
  });
  doc(cases.stale.current, tenantA, cases.stale.anchor, undefined, {
    validTime: Date.parse('2025-01-01T00:00:00.000Z'),
  });
  doc(cases.entityOnly.candidate, tenantA, cases.entityOnly.anchor);
  doc(cases.entityOnly.hidden, tenantA, 'not a candidate', cases.entityOnly.entity);
}

function doc(id: string, tenantId: string, content: string, entity?: string, extra: Record<string, unknown> = {}) {
  const now = Date.parse('2026-07-05T00:00:00.000Z');
  db.db.insert(db.oracleDocuments).values({
    id, tenantId, type: 'learning', sourceFile: `eval/${id}.md`,
    concepts: JSON.stringify(['phase1', 'entity']), createdAt: now, updatedAt: now, indexedAt: now,
    project: 'phase1-entity-eval', createdBy: 'phase1-eval', ...extra,
  }).run();
  db.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(id, content, 'phase1 entity');
  if (entity) db.db.insert(db.oracleEntityLinks).values({
    id: `${tenantId}:${id}:${entityKey(entity)}`, tenantId, documentId: id, entity,
    entityKey: entityKey(entity), weight: 1, createdAt: now, updatedAt: now,
  }).run();
}

async function search(q: string, suffix = ''): Promise<SearchBody> {
  const res = await createTenantFetch((req) => searchRoutes.handle(req))(new Request(
    `http://local/api/search?q=${encodeURIComponent(q)}&mode=fts&limit=5${suffix}`,
    { headers: { [tenantHeader]: tenantA } },
  ));
  expect(res.status).toBe(200);
  return res.json();
}

async function askJson(q: string, extra: Record<string, unknown> = {}): Promise<AskBody> {
  const res = await createTenantFetch((req) => askRoute.handle(req))(new Request('http://local/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [tenantHeader]: tenantA },
    body: JSON.stringify({ q, llm: false, limit: 5, ...extra }),
  }));
  expect(res.status).toBe(200);
  return res.json();
}

async function fanout(q: string, suffix = ''): Promise<FanoutBody> {
  const res = await fanoutFetch(new Request(`http://local/api/v1/memory/fanout?q=${encodeURIComponent(q)}&limit=5${suffix}`, {
    headers: { [tenantHeader]: tenantA },
  }));
  expect(res.status).toBe(200);
  return res.json();
}

function fanoutResult(q: string) {
  const row = fanoutIds(q);
  return {
    ids: row,
    documents: row.map((id) => `fanout ${id}`),
    distances: row.map((_, index) => index * 0.1),
    metadatas: row.map((id) => ({ type: 'memory', source_file: `eval/${id}.md` })),
  };
}

function fanoutIds(q: string): string[] {
  if (q.includes(cases.tenant.anchor)) return [cases.tenant.linked, cases.tenant.plain];
  if (q.includes(cases.stale.anchor)) return [cases.stale.old, cases.stale.current];
  if (q.includes(cases.entityOnly.anchor)) return [cases.entityOnly.candidate];
  for (const key of ['exact', 'alias', 'bigram'] as const) {
    const item = cases[key];
    if (q.includes(item.anchor)) return [item.plain, item.linked];
  }
  return [];
}

function ids(body: { results: Array<{ id: string }> }) {
  return body.results.map((item) => item.id);
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
