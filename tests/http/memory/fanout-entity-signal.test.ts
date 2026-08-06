import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { inArray } from 'drizzle-orm';
import { db, oracleDocuments, oracleEntityLinks } from '../../../src/db/index.ts';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { entityKey } from '../../../src/search/entity-ranking.ts';
import { createMemoryFanoutEndpoint } from '../../../src/routes/memory/fanout.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const touchedIds: string[] = [];
const models: Record<string, EmbeddingModelConfig> = {
  eval: { collection: 'eval_docs', model: 'eval-embed' },
};

afterAll(() => {
  if (!touchedIds.length) return;
  db.delete(oracleEntityLinks).where(inArray(oracleEntityLinks.documentId, touchedIds)).run();
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, touchedIds)).run();
});

function insertDoc(id: string, content: string, entity?: string) {
  touchedIds.push(id);
  const now = Date.parse('2026-07-05T00:00:00.000Z');
  db.insert(oracleDocuments).values({
    id,
    tenantId: 'tenant-a',
    type: 'learning',
    sourceFile: `fanout/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  if (!entity) return;
  db.insert(oracleEntityLinks).values({
    id: `tenant-a:${id}:${entityKey(entity)}`,
    tenantId: 'tenant-a',
    documentId: id,
    entity,
    entityKey: entityKey(entity),
    weight: 1,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function vectorResult(ids: string[]): VectorQueryResult {
  return {
    ids,
    documents: ids.map((id) => `${id} ${id.includes('linked') ? 'Valkyrie Project' : 'plain'} fanout`),
    distances: ids.map((_, index) => index * 0.1),
    metadatas: ids.map((id) => ({ type: 'memory', source_file: `fanout/${id}.md` })),
  };
}

function createFetch(result: VectorQueryResult, confidenceWeight?: number) {
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => models,
    confidenceWeight,
    connect: async () => ({ query: async () => result }),
  }));
  return createApiVersionedFetch(createTenantFetch((request) => app.handle(request)));
}

async function fanout(fetcher: (request: Request) => Promise<Response>) {
  const response = await fetcher(new Request('http://local/api/v1/memory/fanout?q=Valkyrie%20Project&limit=5', {
    headers: { [TENANT_HEADER]: 'tenant-a' },
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

test('fanout SQL entity sidecar reorders candidates without entity-only expansion', async () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plain = `plain-${stamp}`;
  const linked = `linked-${stamp}`;
  const hidden = `hidden-${stamp}`;
  insertDoc(plain, 'plain candidate');
  insertDoc(linked, 'linked candidate', 'Valkyrie Project');
  insertDoc(hidden, 'hidden non-candidate', 'Valkyrie Project');

  const body = await fanout(createFetch(vectorResult([plain, linked])));

  expect(body.ranking.entitySignal).toMatchObject({
    enabled: true,
    source: 'oracle_entity_links',
    weight: 0.06,
    graph: false,
  });
  expect(body.results.map((item: { id: string }) => item.id)).toEqual([linked, plain]);
  expect(body.results[0]).toMatchObject({ entity_score: 1, entity_matches: ['Valkyrie Project'] });
  expect(body.results.map((item: { id: string }) => item.id)).not.toContain(hidden);
});

test('fanout entity sidecar is inert when confidence budget is zero', async () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plain = `zero-plain-${stamp}`;
  const linked = `zero-linked-${stamp}`;
  insertDoc(plain, 'plain candidate');
  insertDoc(linked, 'linked candidate', 'Valkyrie Project');

  const body = await fanout(createFetch(vectorResult([plain, linked]), 0));

  expect(body.ranking.entitySignal).toMatchObject({ enabled: false, weight: 0 });
  expect(body.results.map((item: { id: string }) => item.id)).toEqual([plain, linked]);
  expect(body.results[1].entity_score).toBeUndefined();
});
