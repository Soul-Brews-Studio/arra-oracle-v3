import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleMemories } from '../../../src/db/index.ts';
import { formatCloseoutMemory } from '../../../src/routes/memory/closeout.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const savedIds: string[] = [];

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

class CapturingMemoryVectorIndex implements MemoryVectorIndex {
  readonly memories: MemoryRecord[] = [];

  async index(memory: MemoryRecord) {
    this.memories.push(memory);
    return { indexed: true as const };
  }

  async search() {
    return [];
  }
}

function harness() {
  const vectorIndex = new CapturingMemoryVectorIndex();
  const app = createMemoryRoutes(undefined, vectorIndex);
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), vectorIndex };
}

async function json(response: Response) {
  return JSON.parse(await response.text());
}

test('formatCloseoutMemory turns a session handoff into bootable memory', () => {
  const memory = formatCloseoutMemory({
    summary: 'Finished the morning-tape boot path.',
    next: 'Open the PR and verify CI.',
    blockers: ['none'],
    artifacts: ['PR #1457'],
    tags: ['codex'],
  }, new Date('2026-06-17T00:00:00.000Z'));

  expect(memory).toMatchObject({
    title: 'Session close-out 2026-06-17',
    source: 'challenge-2-closeout',
    tags: ['challenge-2', 'closeout', 'morning-tape', 'codex'],
  });
  expect(memory.content).toContain('## Next boot action');
  expect(memory.content).toContain('- PR #1457');
});

test('POST /api/v1/memory/closeout persists and indexes next-session context', async () => {
  const { fetcher, vectorIndex } = harness();
  const unique = `closeout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetcher(new Request('http://local/api/v1/memory/closeout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Challenge 2 closeout',
      summary: `Saved ${unique} for future boot.`,
      next: 'Read MORNING-TAPE.md, then run the scoped memory tests.',
      blockers: ['none'],
      artifacts: ['MORNING-TAPE.md'],
      tags: ['academy'],
    }),
  }));
  const body = await json(response);
  savedIds.push(body.memory.id);

  expect(response.status).toBe(200);
  expect(body.memory).toMatchObject({ title: 'Challenge 2 closeout', source: 'challenge-2-closeout' });
  expect(body.memory.tags).toEqual(['challenge-2', 'closeout', 'morning-tape', 'academy']);
  expect(body.vector).toMatchObject({ indexed: true });
  expect(vectorIndex.memories[0].content).toContain(unique);

  const tape = await (await fetcher(new Request('http://local/api/v1/memory/morning-tape?format=markdown&limit=5'))).text();
  expect(tape).toContain(unique);
  expect(tape).toContain('Read MORNING-TAPE.md');
});

test('POST /api/v1/memory/closeout rejects blank summaries', async () => {
  const response = await harness().fetcher(new Request('http://local/api/v1/memory/closeout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ summary: '   ' }),
  }));

  expect(response.status).toBe(400);
  expect(await json(response)).toEqual({ success: false, error: 'closeout summary is required' });
});
