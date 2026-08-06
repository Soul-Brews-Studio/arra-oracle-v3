import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { db, oracleMemories } from '../../../src/db/index.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const savedIds: string[] = [];

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

class FakeMemoryVectorIndex implements MemoryVectorIndex {
  readonly memories: MemoryRecord[] = [];

  async index(memory: MemoryRecord) {
    this.memories.push(memory);
    return { indexed: true as const };
  }

  async search(query: string, limit: number) {
    const q = query.toLowerCase();
    return this.memories
      .filter((memory) => [memory.title, memory.content, memory.source, ...(memory.tags ?? [])]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
      .slice(0, limit)
      .map((memory, index) => ({
        memoryId: memory.id,
        vectorId: `memory:${memory.id}`,
        document: memory.content,
        metadata: { type: 'memory', memoryId: memory.id, tenant_id: memory.tenantId ?? 'default' },
        distance: index * 0.1,
        score: 1 - index * 0.1,
      }));
  }
}

function createHarness() {
  const vectorIndex = new FakeMemoryVectorIndex();
  const app = createMemoryRoutes(undefined, vectorIndex);
  return { fetcher: createTenantFetch(createApiVersionedFetch((request) => app.handle(request))), vectorIndex };
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

test('POST /api/v1/memory/save persists a memory, indexes it, and recall finds it by keyword', async () => {
  const { fetcher, vectorIndex } = createHarness();
  const unique = `launch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Morning tape',
      content: `Read the ${unique} context before coding.`,
      tags: ['continuity', 'oracle'],
      source: 'challenge-2',
    }),
  }));
  const saved = await json(save);
  savedIds.push(saved.memory.id);

  expect(save.status).toBe(200);
  expect(saved).toMatchObject({ success: true, vector: { indexed: true }, memory: { title: 'Morning tape' } });
  expect(saved.memory.id).toStartWith('mem_');
  expect(vectorIndex.memories[0].id).toBe(saved.memory.id);

  const recall = await fetcher(new Request(`http://local/api/v1/memory/recall?q=${unique}&limit=5`));
  const body = await json(recall);

  expect(recall.status).toBe(200);
  expect(body).toMatchObject({ query: unique, total: 1 });
  expect(body.items[0]).toMatchObject({ id: saved.memory.id, content: `Read the ${unique} context before coding.` });
  expect(body.confidence).toMatchObject({ stored: false, strategy: 'query-time-confidence' });
  expect(body.items[0].confidence).toMatchObject({ label: 'high' });

  const historical = await json(await fetcher(new Request(
    `http://local/api/v1/memory/recall?q=${unique}&limit=5&asOf=2100-01-01T00:00:00.000Z`,
  )));
  expect(historical.asOf).toBe('2100-01-01T00:00:00.000Z');
  expect(historical.asOfSupportedEndpoints).toContain('/api/memory/recall');
});

test('GET /api/v1/memory/search returns vector similarity hits enriched from SQLite', async () => {
  const { fetcher } = createHarness();
  const phrase = `semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `Similarity should find ${phrase}.`, tags: ['vector'] }),
  }));
  const saved = await json(save);
  savedIds.push(saved.memory.id);

  const search = await fetcher(new Request(`http://local/api/v1/memory/search?q=${phrase}&limit=3`));
  const body = await json(search);

  expect(search.status).toBe(200);
  expect(body).toMatchObject({ success: true, query: phrase, total: 1 });
  expect(body.results[0]).toMatchObject({ id: saved.memory.id, score: 1, vectorId: `memory:${saved.memory.id}` });
  expect(body.confidence).toMatchObject({ stored: false, strategy: 'query-time-confidence' });
  expect(body.results[0].confidence.reasons).toContain('semantic_match');

  const historical = await json(await fetcher(new Request(
    `http://local/api/v1/memory/search?q=${phrase}&limit=3&asOf=2100-01-01T00:00:00.000Z`,
  )));
  expect(historical.asOfSupportedEndpoints).toContain('/api/memory/search');
});

test('memory APIs isolate persisted memories by tenant context', async () => {
  const { fetcher } = createHarness();
  const unique = `tenant-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = (tenantId: string) => ({
    'content-type': 'application/json',
    [TENANT_HEADER]: tenantId,
  });

  async function saveTenantMemory(tenantId: string, title: string) {
    const response = await fetcher(new Request('http://local/api/v1/memory/save', {
      method: 'POST',
      headers: headers(tenantId),
      body: JSON.stringify({ title, content: `${title} owns ${unique}.`, tags: ['tenant'] }),
    }));
    const body = await json(response);
    savedIds.push(body.memory.id);
    return body.memory as MemoryRecord;
  }

  const memoryA = await saveTenantMemory('tenant-a', 'Tenant A memory');
  const memoryB = await saveTenantMemory('tenant-b', 'Tenant B memory');

  expect(memoryA.tenantId).toBe('tenant-a');
  expect(memoryB.tenantId).toBe('tenant-b');

  const recallA = await json(await fetcher(new Request(`http://local/api/v1/memory/recall?q=${unique}`, { headers: headers('tenant-a') })));
  const recallB = await json(await fetcher(new Request(`http://local/api/v1/memory/recall?q=${unique}`, { headers: headers('tenant-b') })));

  expect(recallA.items.map((item: MemoryRecord) => item.id)).toEqual([memoryA.id]);
  expect(recallB.items.map((item: MemoryRecord) => item.id)).toEqual([memoryB.id]);

  const searchA = await json(await fetcher(new Request(`http://local/api/v1/memory/search?q=${unique}`, { headers: headers('tenant-a') })));
  expect(searchA.results.map((item: MemoryRecord) => item.id)).toEqual([memoryA.id]);

  const tapeA = await (await fetcher(new Request('http://local/api/v1/memory/morning-tape?format=markdown', { headers: headers('tenant-a') }))).text();
  expect(tapeA).toContain('Tenant A memory');
  expect(tapeA).not.toContain('Tenant B memory');
});

test('memory save rejects blank content', async () => {
  const res = await createHarness().fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '   ' }),
  }));

  expect(res.status).toBe(400);
  expect(await json(res)).toEqual({ success: false, error: 'memory content is required' });
});

test('memory search de-duplicates vector hits and preserves fallback metadata', async () => {
  const hit = {
    memoryId: 'ghost-memory',
    vectorId: 'memory:ghost-memory:1',
    document: 'Recovered only from vector metadata.',
    metadata: {
      title: 'Vector-only memory',
      tags: '["vector", "fallback"]',
      source_file: 'session://vector-only',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T01:00:00.000Z',
    },
    distance: 0,
    score: 0.91,
  };
  const store = { save: () => { throw new Error('unused'); }, recall: () => [], getByIds: () => [] } as any;
  const vectorIndex: MemoryVectorIndex = {
    async index() { return { indexed: true }; },
    async search() { return [hit, { ...hit, vectorId: 'memory:ghost-memory:2', score: 0.6 }]; },
  };
  const app = createMemoryRoutes(store, vectorIndex);
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const res = await fetcher(new Request('http://local/api/v1/memory/search?q=ghost'));
  const body = await json(res);

  expect(res.status).toBe(200);
  expect(body.results).toHaveLength(1);
  expect(body.results[0]).toMatchObject({
    id: 'ghost-memory',
    title: 'Vector-only memory',
    tags: ['vector', 'fallback'],
    source: 'session://vector-only',
    score: 0.91,
  });
  expect(body.results[0].confidence.reasons).toContain('source_present');
});
