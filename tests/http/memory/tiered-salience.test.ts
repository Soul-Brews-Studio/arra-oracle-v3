import { afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { db, oracleMemories } from '../../../src/db/index.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import { memorySalience } from '../../../src/routes/memory/salience.ts';
import type { MemoryRecord } from '../../../src/routes/memory/store.ts';
import type { MemoryVectorIndex } from '../../../src/routes/memory/vector.ts';

const savedIds: string[] = [];

class NoopVectorIndex implements MemoryVectorIndex {
  async index() { return { indexed: false as const, error: 'not needed' }; }
  async search() { return []; }
}

const fetcher = createApiVersionedFetch((request) => createMemoryRoutes(undefined, new NoopVectorIndex()).handle(request));

async function json(response: Response) {
  return JSON.parse(await response.text());
}

afterAll(() => {
  if (savedIds.length) db.delete(oracleMemories).where(inArray(oracleMemories.id, savedIds)).run();
});

test('memorySalience migrates core/warm/cold tiers from heat', () => {
  const now = new Date('2026-06-17T00:00:00.000Z');
  expect(memorySalience({
    tier: 'warm',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    usageCount: 0,
  }, now)).toMatchObject({ tier: 'warm', migration: 'stable' });

  expect(memorySalience({
    tier: 'warm',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    usageCount: 0,
  }, now)).toMatchObject({ tier: 'cold', migration: 'demote' });

  expect(memorySalience({
    tier: 'warm',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    usageCount: 24,
    lastAccessedAt: now.toISOString(),
  }, now)).toMatchObject({ tier: 'core', migration: 'promote' });
});

test('memory tiers preserve cold eviction and promote recalled cold memories', async () => {
  const unique = `tiered-salience-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const save = await fetcher(new Request('http://local/api/v1/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Tiered salience', content: `Recover ${unique}.`, tags: ['tiered'] }),
  }));
  const saved = await json(save) as { memory: MemoryRecord };
  savedIds.push(saved.memory.id);

  const old = Date.parse('2025-01-01T00:00:00.000Z');
  db.update(oracleMemories).set({
    createdAt: old,
    updatedAt: old,
    tier: 'warm',
    heatScore: 0,
    usageCount: 0,
    lastAccessedAt: null,
  }).where(eq(oracleMemories.id, saved.memory.id)).run();

  const initial = await json(await fetcher(new Request('http://local/api/v1/memory/tiers?limit=10')));
  expect(initial.eviction).toContain('preserved');
  expect(initial.items.cold.map((item: MemoryRecord) => item.id)).toContain(saved.memory.id);

  const ambient = await json(await fetcher(new Request('http://local/api/v1/memory/recall?limit=25')));
  expect(ambient.items.map((item: MemoryRecord) => item.id)).not.toContain(saved.memory.id);

  const recalled = await json(await fetcher(new Request(`http://local/api/v1/memory/recall?q=${unique}&limit=5`)));
  expect(recalled.items[0]).toMatchObject({ id: saved.memory.id, tier: 'warm', usageCount: 1 });
  expect(recalled.items[0].heatScore).toBeGreaterThanOrEqual(0.22);

  const migrated = await json(await fetcher(new Request('http://local/api/v1/memory/tiers?limit=10')));
  expect(migrated.items.warm.map((item: MemoryRecord) => item.id)).toContain(saved.memory.id);
});
