import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../../../src/db/index.ts';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createMemoryFanoutEndpoint } from '../../../src/routes/memory/fanout.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const touchedIds: string[] = [];
const models: Record<string, EmbeddingModelConfig> = {
  eval: { collection: 'eval_docs', model: 'eval-embed' },
};

afterAll(() => {
  if (touchedIds.length) db.delete(oracleDocuments).where(inArray(oracleDocuments.id, touchedIds)).run();
});

function insertDoc(input: {
  id: string; tenantId?: string; validTime?: number; supersededBy?: string; supersededAt?: number;
}) {
  touchedIds.push(input.id);
  const now = Date.parse('2026-07-05T00:00:00.000Z');
  db.insert(oracleDocuments).values({
    id: input.id,
    tenantId: input.tenantId ?? 'tenant-a',
    type: 'learning',
    sourceFile: `fanout/${input.id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    validTime: input.validTime,
    supersededBy: input.supersededBy,
    supersededAt: input.supersededAt,
  }).run();
}

function vectorResult(ids: string[]): VectorQueryResult {
  return {
    ids,
    documents: ids.map((id) => `${id} fanout fixture`),
    distances: ids.map((_, index) => index * 0.1),
    metadatas: ids.map((id) => ({ type: 'memory', source_file: `fanout/${id}.md` })),
  };
}

function createFetch(result: VectorQueryResult) {
  const wheres: Array<Record<string, unknown> | undefined> = [];
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => models,
    confidenceWeight: 0,
    connect: async () => ({
      query: async (_q, _limit, where) => {
        wheres.push(where);
        return result;
      },
    }),
  }));
  return { fetcher: createApiVersionedFetch(createTenantFetch((request) => app.handle(request))), wheres };
}

async function bodyFor(fetcher: (request: Request) => Promise<Response>, url: string) {
  const response = await fetcher(new Request(url, { headers: { [TENANT_HEADER]: 'tenant-a' } }));
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

test('fanout applies tenant isolation before fusion', async () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const keep = `tenant-keep-${stamp}`;
  const leak = `tenant-leak-${stamp}`;
  insertDoc({ id: keep, tenantId: 'tenant-a' });
  insertDoc({ id: leak, tenantId: 'tenant-b' });

  const { fetcher, wheres } = createFetch(vectorResult([leak, keep]));
  const body = await bodyFor(fetcher, 'http://local/api/v1/memory/fanout?q=tenant&limit=5');

  expect(body.results.map((item: { id: string }) => item.id)).toEqual([keep]);
  expect(wheres).toEqual([{ tenant_id: 'tenant-a' }]);
});

test('fanout applies asOf stale filtering before fusion', async () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const old = `stale-old-${stamp}`;
  const current = `stale-current-${stamp}`;
  insertDoc({
    id: old,
    validTime: Date.parse('2024-01-01T00:00:00.000Z'),
    supersededBy: current,
    supersededAt: Date.parse('2025-01-01T00:00:00.000Z'),
  });
  insertDoc({ id: current, validTime: Date.parse('2025-01-01T00:00:00.000Z') });

  const { fetcher } = createFetch(vectorResult([old, current]));
  const asOf = encodeURIComponent('2026-01-01T00:00:00.000Z');
  const body = await bodyFor(fetcher, `http://local/api/v1/memory/fanout?q=stale&limit=5&asOf=${asOf}`);

  expect(body.results.map((item: { id: string }) => item.id)).toEqual([current]);
  expect(body.asOfSupportedEndpoints).toContain('/api/memory/fanout');
});
