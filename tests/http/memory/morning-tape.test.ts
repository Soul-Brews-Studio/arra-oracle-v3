import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleMemories } from '../../../src/db/index.ts';
import { buildMorningTape } from '../../../src/routes/memory/morning-tape.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const savedIds: string[] = [];

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

class NoopMemoryVectorIndex implements MemoryVectorIndex {
  async index() { return { indexed: false as const, error: 'not needed' }; }
  async search() { return []; }
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

test('buildMorningTape renders a two-minute recovery document', () => {
  const memory: MemoryRecord = {
    id: 'mem_boot',
    title: 'Boot rule',
    content: 'Read git status before making any code change.',
    tags: ['continuity'],
    source: 'challenge-2',
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  };

  const tape = buildMorningTape([memory], new Date('2026-06-16T00:01:00.000Z'));

  expect(tape.readTimeMinutes).toBe(2);
  expect(tape.memoryCount).toBe(1);
  expect(tape.markdown).toContain('# MORNING-TAPE');
  expect(tape.markdown).toContain('Boot rule [continuity]: Read git status');
});

test('GET /api/v1/memory/morning-tape includes recent persisted memories', async () => {
  const app = createMemoryRoutes(undefined, new NoopMemoryVectorIndex());
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const unique = `morning-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Morning context', content: `Recover ${unique} quickly.`, tags: ['morning'] }),
  }));
  const saved = await json(save);
  savedIds.push(saved.memory.id);

  const response = await fetcher(new Request('http://local/api/v1/memory/morning-tape?limit=5'));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ readTimeMinutes: 2 });
  expect(body.markdown).toContain(unique);
  expect(body.sections.map((section: { title: string }) => section.title)).toContain('Fresh memory');
});
