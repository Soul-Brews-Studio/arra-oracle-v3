import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleDocuments } from '../../../src/db/index.ts';
import { createMemoryFanoutEndpoint } from '../../../src/routes/memory/fanout.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

const touchedIds: string[] = [];
const models: Record<string, EmbeddingModelConfig> = {
  alpha: { collection: 'alpha_docs', model: 'alpha-embed' },
};

afterAll(() => {
  if (touchedIds.length) db.delete(oracleDocuments).where(inArray(oracleDocuments.id, touchedIds)).run();
});

function vectorResult(id: string): VectorQueryResult {
  return {
    ids: [id],
    documents: [`${id} reinforced memory`],
    distances: [0],
    metadatas: [{ type: 'memory', source_file: `${id}.md` }],
  };
}

function createFetch(id: string, extra: { reinforce?: (ids: string[]) => void | Promise<void> } = {}) {
  const app = new Elysia({ prefix: '/api' }).use(createMemoryFanoutEndpoint({
    models: () => models,
    connect: async () => ({ query: async () => vectorResult(id) }),
    ...extra,
  }));
  return createApiVersionedFetch((request) => app.handle(request));
}

function insertDocument(id: string, now = Date.now()) {
  touchedIds.push(id);
  db.insert(oracleDocuments).values({
    id,
    type: 'memory',
    sourceFile: `${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    usageCount: 0,
  }).run();
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

async function sleep(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUsage(id: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = db.select({
      usageCount: oracleDocuments.usageCount,
      lastAccessedAt: oracleDocuments.lastAccessedAt,
    }).from(oracleDocuments).where(eq(oracleDocuments.id, id)).get();
    if (row?.usageCount === 1) return row;
    await sleep(5);
  }
  throw new Error(`usage_count did not increment for ${id}`);
}

test('memory fanout bumps returned document usage through Drizzle after recall', async () => {
  const id = `doc-reinforce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const before = Date.now();
  insertDocument(id, before - 1000);

  const response = await createFetch(id)(new Request('http://local/api/v1/memory/fanout?q=reinforce'));
  const body = await json(response);
  const row = await waitForUsage(id);

  expect(response.status).toBe(200);
  expect(body.results[0].id).toBe(id);
  expect(row.usageCount).toBe(1);
  expect(row.lastAccessedAt ?? 0).toBeGreaterThanOrEqual(before);
});

test('memory fanout does not await the reinforcement hook before responding', async () => {
  const id = `doc-nonblocking-${Date.now()}`;
  let release: (() => void) | undefined;
  let completed = false;
  const calls: string[][] = [];
  const fetcher = createFetch(id, {
    reinforce: async (ids) => {
      calls.push(ids);
      await new Promise<void>((resolve) => { release = resolve; });
      completed = true;
    },
  });

  const response = await Promise.race([
    fetcher(new Request('http://local/api/v1/memory/fanout?q=reinforce')),
    sleep(100).then(() => 'timeout' as const),
  ]);
  if (response === 'timeout') {
    release?.();
    throw new Error('fanout response waited for reinforcement hook');
  }
  const body = await json(response);
  await sleep();

  expect(body.results[0].id).toBe(id);
  expect(calls).toEqual([[id]]);
  expect(completed).toBe(false);
  release?.();
  await sleep();
  expect(completed).toBe(true);
});
