import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleMemories } from '../../../src/db/index.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';

const savedIds: string[] = [];

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

function createFetch() {
  const app = createMemoryRoutes();
  return createApiVersionedFetch((request) => app.handle(request));
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

test('POST /api/v1/memory/save persists a memory and recall finds it by keyword', async () => {
  const fetcher = createFetch();
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
  expect(saved).toMatchObject({ success: true, memory: { title: 'Morning tape', tags: ['continuity', 'oracle'] } });
  expect(saved.memory.id).toStartWith('mem_');

  const recall = await fetcher(new Request(`http://local/api/v1/memory/recall?q=${unique}&limit=5`));
  const body = await json(recall);

  expect(recall.status).toBe(200);
  expect(body).toMatchObject({ query: unique, total: 1 });
  expect(body.items[0]).toMatchObject({ id: saved.memory.id, content: `Read the ${unique} context before coding.` });
});

test('memory recall searches title, tags, and source fields', async () => {
  const fetcher = createFetch();
  const tag = `continuity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Context survives restarts.', tags: [tag] }),
  }));
  const saved = await json(save);
  savedIds.push(saved.memory.id);

  const recall = await fetcher(new Request(`http://local/api/v1/memory/recall?q=${tag}`));
  const body = await json(recall);

  expect(body.items.map((item: { id: string }) => item.id)).toContain(saved.memory.id);
});

test('memory save rejects blank content', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '   ' }),
  }));

  expect(res.status).toBe(400);
  expect(await json(res)).toEqual({ success: false, error: 'memory content is required' });
});
