import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { db, oracleMemories, resetDefaultDatabaseForTests } from '../../../src/db/index.ts';

resetDefaultDatabaseForTests();
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import { MemoryStore, type MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const savedIds: string[] = [];

class CrossTenantVectorIndex implements MemoryVectorIndex {
  readonly memories: MemoryRecord[] = [];

  async index(memory: MemoryRecord) {
    this.memories.push(memory);
    return { indexed: true as const };
  }

  async search(query: string, limit: number) {
    const q = query.toLowerCase();
    return this.memories
      .filter((memory) => memory.content.toLowerCase().includes(q))
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

const vectorIndex = new CrossTenantVectorIndex();
const app = createMemoryRoutes(new MemoryStore(db), vectorIndex);
const fetcher = createTenantFetch((request) => app.handle(request));

function request(tenantId: string, path: string, init: RequestInit = {}) {
  return fetcher(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

test('memory routes stamp tenant_id and hide cross-tenant memories', async () => {
  const shared = `tenant-memory-${stamp}`;
  const createA = await request(tenantA, '/api/memory/save', {
    method: 'POST',
    body: JSON.stringify({ content: `alpha ${shared}`, title: 'Alpha memory' }),
  });
  const createB = await request(tenantB, '/api/memory/save', {
    method: 'POST',
    body: JSON.stringify({ content: `beta ${shared}`, title: 'Beta memory' }),
  });
  const savedA = await json(createA);
  const savedB = await json(createB);
  savedIds.push(savedA.memory.id, savedB.memory.id);

  expect(savedA.memory).toMatchObject({ tenantId: tenantA });
  expect(savedB.memory).toMatchObject({ tenantId: tenantB });

  const recallA = await json(await request(tenantA, `/api/memory/recall?q=${shared}`));
  expect(recallA.items.map((item: { id: string }) => item.id)).toEqual([savedA.memory.id]);

  const searchA = await json(await request(tenantA, `/api/memory/search?q=${shared}`));
  expect(searchA.results.map((item: { id: string }) => item.id)).toEqual([savedA.memory.id]);

  const tapeA = await json(await request(tenantA, '/api/memory/morning-tape?limit=10'));
  expect(tapeA.markdown).toContain(`alpha ${shared}`);
  expect(tapeA.markdown).not.toContain(`beta ${shared}`);
});
