import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { atomicOps } from '../../src/db/atomic-ops.ts';
import { createDb } from '../../src/db/factory.ts';
import type { VectorStoreAdapter } from '../../src/vector/adapter.ts';
import { createVectorStore } from '../../src/vector/factory.ts';
import type {
  CloudflareD1Database,
  CloudflareD1Statement,
  CloudflareVectorizeBinding,
} from '../../src/vector/adapters/cloudflare.ts';
import { oracleProxyTool, type TextToolResult } from '../../workers/mcp/src/proxy.ts';

type SqliteLike = { query: (query: string) => { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown } };
type Vector = { id: string; values: number[]; metadata?: Record<string, unknown> };

function sqliteD1(sqlite: SqliteLike, txDb: unknown): CloudflareD1Database {
  return {
    prepare(query: string): CloudflareD1Statement {
      let params: unknown[] = [];
      const statement: CloudflareD1Statement = {
        bind(...values) { params = values; return statement; },
        async run() { sqlite.query(query).run(...params); return { results: [] }; },
        async all<T>() { return { results: sqlite.query(query).all(...params) as T[] }; },
        async first<T>() { return sqlite.query(query).get(...params) as T | null; },
      };
      return statement;
    },
    async batch(statements) {
      return atomicOps(txDb as never, statements.map((statement) => () => statement.run()));
    },
  };
}

function vectorizeBinding(): CloudflareVectorizeBinding {
  const vectors = new Map<string, Vector>();
  return {
    upsert: async (items) => { for (const item of items as Vector[]) vectors.set(item.id, item); },
    query: async (_vector, options = {}) => {
      const tenant = ((options.filter as Record<string, { $eq?: unknown }> | undefined)?.tenantId)?.$eq;
      const topK = typeof options.topK === 'number' ? options.topK : 10;
      return {
        matches: [...vectors.values()]
          .filter((item) => !tenant || item.metadata?.tenantId === tenant)
          .slice(0, topK)
          .map((item) => ({ id: item.id, score: 0.9, metadata: item.metadata })),
      };
    },
    getByIds: async (ids) => ids.map((id) => vectors.get(id)).filter(Boolean),
    deleteByIds: async (ids) => { for (const id of ids) vectors.delete(id); },
  };
}

async function createVectorTable(db: unknown) {
  await atomicOps(db as never, [
    (tx: { run: (query: unknown) => unknown }) => tx.run(sql`
      CREATE TABLE oracle_vector_documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        document TEXT NOT NULL,
        metadata TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      )
    `),
  ]);
}

function payload(result: TextToolResult) {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text) as { tenant: string | null; ids: string[]; documents: string[] };
}

describe('McpAgent proxy + createDb + VectorStoreAdapter integration', () => {
  let close: (() => void) | undefined;
  afterEach(() => { close?.(); close = undefined; });

  test('keeps two OAuth tenants isolated through one MCP search endpoint', async () => {
    const connection = await createDb({}, { runtime: 'bun', dbPath: ':memory:' });
    close = connection.close;
    await createVectorTable(connection.db);

    const store: VectorStoreAdapter = createVectorStore({
      type: 'cloudflare-vectorize',
      collectionName: 'edge_docs',
      cfD1: sqliteD1(connection.sqlite, connection.db),
      cfVectorize: vectorizeBinding(),
      cfAi: { run: async (_model, input) => ({ data: input.text.map(() => [1, 0, 0]) }) },
    });
    await store.ensureCollection();
    await store.addDocuments([
      { id: 'school-a-doc', document: 'alpha private note', metadata: { tenantId: 'school-a' }, vector: [1, 0, 0] },
      { id: 'school-b-doc', document: 'beta private note', metadata: { tenantId: 'school-b' }, vector: [0, 1, 0] },
    ]);

    const seen: Array<{ path: string; tenant: string | null; query: string | null }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const tenant = new Headers(init?.headers).get('X-Oracle-Tenant');
      seen.push({ path: url.pathname, tenant, query: url.searchParams.get('q') });
      const result = await store.query(url.searchParams.get('q') ?? '', 5, tenant ? { tenantId: tenant } : undefined);
      return Response.json({ tenant, ids: result.ids, documents: result.documents });
    }) as typeof fetch;

    async function searchAs(authTenant: string, toolTenant: string) {
      return payload(await oracleProxyTool({ ORACLE_URL: 'https://oracle.test/root' }, {
        path: '/api/search',
        query: { q: 'private', limit: 5 },
        tenantId: toolTenant,
        authContext: { claims: { tenant_id: authTenant } },
      }, fetcher));
    }

    const tenantA = await searchAs('school-a', 'school-b');
    const tenantB = await searchAs('school-b', 'school-a');

    expect(seen).toEqual([
      { path: '/root/api/search', tenant: 'school-a', query: 'private' },
      { path: '/root/api/search', tenant: 'school-b', query: 'private' },
    ]);
    expect(tenantA).toEqual({
      tenant: 'school-a',
      ids: ['school-a-doc'],
      documents: ['alpha private note'],
    });
    expect(tenantB).toEqual({
      tenant: 'school-b',
      ids: ['school-b-doc'],
      documents: ['beta private note'],
    });
    expect(tenantA.ids).not.toEqual(tenantB.ids);
    expect(await store.getStats()).toEqual({ count: 2 });
  });
});
