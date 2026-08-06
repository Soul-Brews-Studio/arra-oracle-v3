import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../../src/db/create.ts';
import { oracleMemories } from '../../../src/db/schema.ts';
import { MemoryStore } from '../../../src/routes/memory/store.ts';

const connection = createDatabase(':memory:');
const now = Date.parse('2026-06-17T00:00:00.000Z');

afterAll(() => connection.storage.close());

test('memory TTL auto-supersedes expired memories off the write path', () => {
  const store = new MemoryStore(connection.db, { enabled: true, now: () => now });
  const expired = store.save({
    content: 'stale launch note',
    validUntil: '2026-06-16T23:59:59.000Z',
  });
  const active = store.save({
    content: 'fresh launch note',
    validUntil: '2026-06-18T00:00:00.000Z',
  });

  expect(connection.db.select().from(oracleMemories).where(eq(oracleMemories.id, expired.id)).get()?.supersededAt).toBeNull();
  expect(store.recall('launch', 10).map((memory) => memory.id)).toEqual([active.id]);

  const stale = connection.db.select().from(oracleMemories).where(eq(oracleMemories.id, expired.id)).get();
  expect(stale?.supersededAt).toBe(now);
  expect(stale?.supersededReason).toBe('memory TTL expired');
});

test('memory TTL stays configurable and disabled stores keep expired memories visible', () => {
  const store = new MemoryStore(connection.db, { enabled: false, now: () => now });
  const memory = store.save({ content: 'configurable ttl note', validUntil: '2026-06-16T00:00:00.000Z' });

  expect(store.recall('configurable', 10).map((item) => item.id)).toContain(memory.id);
  expect(connection.db.select().from(oracleMemories).where(eq(oracleMemories.id, memory.id)).get()?.supersededAt).toBeNull();
});

test('memory save rejects malformed validUntil values', () => {
  const store = new MemoryStore(connection.db, { enabled: true, now: () => now });

  expect(() => store.save({ content: 'bad ttl', validUntil: 'not-a-date' })).toThrow('invalid valid-time timestamp');
});
