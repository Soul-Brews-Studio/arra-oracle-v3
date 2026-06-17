import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createEntitySearchEndpoint } from '../../../src/routes/vector/entity-search.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const result: VectorQueryResult = {
  ids: ['doc-a:entity:alpha-project'],
  documents: ['Alpha Project'],
  distances: [0.25],
  metadatas: [{ entity: 'Alpha Project', source_doc_id: 'doc-a', tenant_id: 'tenant-a', type: 'entity' }],
};

function createFetch(queryImpl: () => Promise<VectorQueryResult> = async () => result) {
  const presets: any[] = [];
  const store = {
    connect: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    query: mock(queryImpl),
    close: mock(async () => {}),
  };
  const app = new Elysia({ prefix: '/api' }).use(createEntitySearchEndpoint({
    getModels: () => ({ 'bge-m3': { collection: 'oracle_knowledge_bge_m3', model: 'bge-m3' } }),
    createStore: (preset) => {
      presets.push(preset);
      return store;
    },
  }));
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), presets, store };
}

test('GET /api/v1/vector/entities/search queries entity sidecar collection', async () => {
  const { fetcher, presets, store } = createFetch();
  const res = await fetcher(new Request('http://local/api/v1/vector/entities/search?q=Alpha&limit=3'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(presets[0].collection).toBe('oracle_knowledge_bge_m3_entities');
  expect(store.query).toHaveBeenCalledWith('Alpha', 3, undefined);
  expect(store.close).toHaveBeenCalledTimes(1);
  expect(body).toMatchObject({ mode: 'entity-vector', collection: 'oracle_knowledge_bge_m3_entities' });
  expect(body.results[0]).toMatchObject({ entity: 'Alpha Project', sourceDocId: 'doc-a', tenantId: 'tenant-a' });
});

test('GET /api/v1/vector/entities/search applies tenant metadata filter', async () => {
  const { fetcher, store } = createFetch();
  const tenantFetch = createTenantFetch(fetcher);
  const res = await tenantFetch(new Request('http://local/api/v1/vector/entities/search?q=Alpha', {
    headers: { [TENANT_HEADER]: 'tenant-a' },
  }));

  expect(res.status).toBe(200);
  expect(store.query).toHaveBeenCalledWith('Alpha', 10, { tenant_id: 'tenant-a' });
});

test('GET /api/v1/vector/entities/search validates query and closes on failure', async () => {
  const missing = await createFetch().fetcher(new Request('http://local/api/v1/vector/entities/search?q=%20'));
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: 'Missing query parameter: q' });

  const { fetcher, store } = createFetch(async () => { throw new Error('adapter down'); });
  const failed = await fetcher(new Request('http://local/api/v1/vector/entities/search?q=Alpha'));
  expect(failed.status).toBe(400);
  expect(await failed.json()).toMatchObject({ results: [], error: 'Entity search failed', message: 'adapter down' });
  expect(store.close).toHaveBeenCalledTimes(1);
});
