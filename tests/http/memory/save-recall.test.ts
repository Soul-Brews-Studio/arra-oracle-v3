import { expect, test } from 'bun:test';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import { InMemoryStore } from '../../../src/routes/memory/store.ts';

function createFetch() {
  const app = createMemoryRoutes(new InMemoryStore());
  return createApiVersionedFetch((request) => app.handle(request));
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

test('POST /api/v1/memory/save stores a memory and recall finds it', async () => {
  const fetcher = createFetch();
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Morning tape',
      content: 'Read the launch context before coding.',
      tags: ['continuity', 'oracle'],
      source: 'challenge-2',
    }),
  }));
  const saved = await json(save);

  expect(save.status).toBe(200);
  expect(saved).toMatchObject({ success: true, memory: { title: 'Morning tape', tags: ['continuity', 'oracle'] } });
  expect(saved.memory.id).toStartWith('mem_');

  const recall = await fetcher(new Request('http://local/api/v1/memory/recall?q=launch&limit=5'));
  const body = await json(recall);

  expect(recall.status).toBe(200);
  expect(body).toMatchObject({ query: 'launch', total: 1 });
  expect(body.items[0]).toMatchObject({ id: saved.memory.id, content: 'Read the launch context before coding.' });
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
