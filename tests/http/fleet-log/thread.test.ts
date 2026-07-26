/**
 * `GET /api/fleet-log/thread/:key` (#2879).
 *
 * A separate endpoint rather than a `search` filter, because that is what
 * `FLEET_THREAD_CONTRACT` declares and because the ordering genuinely differs: a thread reads
 * oldest-first as a conversation, search reads newest-first as a log. Those two orderings are
 * the reason this is not just a query parameter, so both are pinned here.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, resetDefaultDatabaseForTests, sqlite } from '../../../src/db/index.ts';

resetDefaultDatabaseForTests();
import { fleetMessages } from '../../../src/db/fleet-log-schema.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createFleetLogRoutes } from '../../../src/routes/fleet-log/index.ts';

const stamp = `${Date.now()}`;
const TENANT = `fleet-thread-${stamp}`;
const T0 = 1_750_000_000_000;

function thread(tenantId: string, key: string) {
  return createTenantFetch((request) => createFleetLogRoutes().handle(request))(
    new Request(`http://local/api/fleet-log/thread/${encodeURIComponent(key)}`, {
      headers: { [TENANT_HEADER]: tenantId },
    }),
  );
}

async function body(res: Response) {
  return (await res.json()) as { success: boolean; data?: { key: string; messages: Array<Record<string, unknown>>; total: number } };
}

const KEY = `thread-${stamp}`;
const ROWS = [
  { id: `${stamp}-b`, channel: 'maw', threadKey: KEY, text: 'second', ts: T0 + 2000 },
  { id: `${stamp}-a`, channel: 'maw', threadKey: KEY, text: 'first', ts: T0 + 1000 },
  { id: `${stamp}-c`, channel: 'maw', threadKey: KEY, text: 'third', ts: T0 + 3000 },
  { id: `${stamp}-x`, channel: 'maw', threadKey: `other-${stamp}`, text: 'different thread', ts: T0 },
];

beforeAll(() => {
  for (const row of ROWS) db.insert(fleetMessages).values({ ...row, tenantId: TENANT, ingestedAt: T0 }).run();
});

afterAll(() => {
  for (const row of ROWS) db.delete(fleetMessages).where(eq(fleetMessages.id, row.id)).run();
  sqlite.prepare('DELETE FROM fleet_messages WHERE tenant_id = ?').run(TENANT);
});

describe('a thread reads as a conversation', () => {
  test('messages come back oldest-first, unlike search', async () => {
    const res = await thread(TENANT, KEY);
    expect(res.status).toBe(200);
    const json = await body(res);
    // Inserted out of order on purpose — the ordering must come from ts, not insertion.
    expect(json.data?.messages.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  test('only the requested thread is returned', async () => {
    const json = await body(await thread(TENANT, KEY));
    expect(json.data?.total).toBe(3);
  });

  test('the key is echoed back', async () => {
    expect((await body(await thread(TENANT, KEY))).data?.key).toBe(KEY);
  });
});

describe('an unknown key is an empty thread, not a 404', () => {
  test('a key that matches nothing returns 200 with no messages', async () => {
    /**
     * `thread_key` is a heuristic grouping and explicitly NOT a foreign key
     * (src/db/fleet-log-schema.ts:11). A key with no rows is indistinguishable from one whose
     * messages have not been ingested yet, so 404 would be claiming knowledge the table does
     * not have.
     */
    const res = await thread(TENANT, `nonexistent-${stamp}`);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.success).toBe(true);
    expect(json.data?.messages).toEqual([]);
    expect(json.data?.total).toBe(0);
  });
});

describe('tenant isolation', () => {
  test('a second tenant cannot read the first tenant thread', async () => {
    const other = await body(await thread(`other-${stamp}`, KEY));
    expect(other.data?.messages).toEqual([]);
    expect(other.data?.total).toBe(0);
  });
});
