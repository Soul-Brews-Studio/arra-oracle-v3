/**
 * `GET /api/fleet-log/search` must satisfy the contract the frontend already declares (#2879).
 *
 * `frontend/src/pages/fleetLogMock.ts` has held `FLEET_SEARCH_CONTRACT` while the page rendered
 * fixtures. These tests read `from`/`to` as sender/recipient and `since`/`until` as the time
 * window, which is what `FleetLogFilters` means — reading them as a date range would produce an
 * endpoint that matched the string and not the intent.
 *
 * The 400 tests are the ones worth keeping. A filter that silently matches everything when it
 * does not understand its input is this repo's dominant defect shape (#2857, #2863, #2877,
 * #2880): a stage does nothing while the pipeline reports success.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.ts';
import { fleetMessages } from '../../../src/db/fleet-log-schema.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createFleetLogRoutes } from '../../../src/routes/fleet-log/index.ts';

const stamp = `${Date.now()}`;
const TENANT = `fleet-search-${stamp}`;
const T0 = 1_750_000_000_000;

function search(tenantId: string, qs: string) {
  return createTenantFetch((request) => createFleetLogRoutes().handle(request))(
    new Request(`http://local/api/fleet-log/search${qs}`, { headers: { [TENANT_HEADER]: tenantId } }),
  );
}

async function body(res: Response) {
  return (await res.json()) as { success: boolean; error?: string; data?: { messages: Array<Record<string, unknown>>; total: number; limit: number; offset: number } };
}

const ROWS = [
  { id: `${stamp}-1`, channel: 'maw', fromId: 'claude48', toId: 'm5:arra-oracle-v3', threadKey: 'th-1', text: 'the indexer queued zero vector jobs', ts: T0 },
  { id: `${stamp}-2`, channel: 'vault', fromId: 'digger', toId: 'm5:digger', threadKey: 'th-1', text: 'keep rawPath and threadKey approximate', ts: T0 + 1000 },
  { id: `${stamp}-3`, channel: 'discord', fromId: 'atlas', toId: 'jan', threadKey: 'th-2', text: 'unrelated chatter', ts: T0 + 2000 },
];

beforeAll(() => {
  for (const row of ROWS) {
    db.insert(fleetMessages).values({ ...row, tenantId: TENANT, ingestedAt: T0 }).run();
  }
});

afterAll(() => {
  for (const row of ROWS) db.delete(fleetMessages).where(eq(fleetMessages.id, row.id)).run();
});

describe('the route exists and answers the declared contract', () => {
  test('an unfiltered search returns this tenant messages, newest first', async () => {
    const res = await search(TENANT, '');
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.success).toBe(true);
    expect(json.data?.total).toBe(3);
    // Newest-first is what a log console wants, and what idx_fleet_msg_tenant_ts serves.
    expect(json.data?.messages.map((m) => m.id)).toEqual([`${stamp}-3`, `${stamp}-2`, `${stamp}-1`]);
  });

  test('query matches message text', async () => {
    const json = await body(await search(TENANT, '?query=vector%20jobs'));
    expect(json.data?.messages.map((m) => m.id)).toEqual([`${stamp}-1`]);
  });

  test('channel filters, and accepts several', async () => {
    const one = await body(await search(TENANT, '?channel=vault'));
    expect(one.data?.messages.map((m) => m.id)).toEqual([`${stamp}-2`]);

    const two = await body(await search(TENANT, '?channel=vault,discord'));
    expect(two.data?.total).toBe(2);
  });

  test('from and to are sender and recipient, not a date range', async () => {
    // The single most likely misreading of the contract string.
    const from = await body(await search(TENANT, '?from=digger'));
    expect(from.data?.messages.map((m) => m.id)).toEqual([`${stamp}-2`]);

    const to = await body(await search(TENANT, '?to=jan'));
    expect(to.data?.messages.map((m) => m.id)).toEqual([`${stamp}-3`]);
  });

  test('since and until bound the time window, inclusive', async () => {
    const json = await body(await search(TENANT, `?since=${T0 + 1000}&until=${T0 + 2000}`));
    expect(json.data?.total).toBe(2);
  });

  test('since accepts an ISO date, which is what a date input sends', async () => {
    const json = await body(await search(TENANT, '?since=2000-01-01'));
    expect(json.data?.total).toBe(3);
  });
});

describe('an unusable filter is a 400, never a silent match-everything', () => {
  test('an unknown channel is rejected and names the known ones', async () => {
    const res = await search(TENANT, '?channel=slack');
    expect(res.status).toBe(400);
    const json = await body(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('slack');
    expect(json.error).toContain('maw');
  });

  test('one bad channel in a list rejects the whole request', async () => {
    // Otherwise a typo silently widens the result set.
    expect((await search(TENANT, '?channel=vault,slack')).status).toBe(400);
  });

  test('an unparseable since is rejected', async () => {
    const res = await search(TENANT, '?since=not-a-date');
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain('since');
  });

  test('a negative offset is rejected', async () => {
    expect((await search(TENANT, '?offset=-1')).status).toBe(400);
  });

  test('a zero limit is rejected rather than returning everything', async () => {
    expect((await search(TENANT, '?limit=0')).status).toBe(400);
  });
});

describe('pagination', () => {
  test('limit and offset page through the results', async () => {
    const first = await body(await search(TENANT, '?limit=2&offset=0'));
    expect(first.data?.messages).toHaveLength(2);
    expect(first.data?.total).toBe(3);

    const second = await body(await search(TENANT, '?limit=2&offset=2'));
    expect(second.data?.messages).toHaveLength(1);
    // total is the unpaginated count, so a client can render "3 results".
    expect(second.data?.total).toBe(3);
  });

  test('an oversized limit is capped, not rejected', async () => {
    const json = await body(await search(TENANT, '?limit=100000'));
    expect(json.data?.limit).toBe(200);
  });
});

describe('tenant isolation', () => {
  test('a second tenant cannot read the first tenant messages', async () => {
    const other = await body(await search(`other-${stamp}`, ''));
    expect(other.data?.total).toBe(0);
    expect(other.data?.messages).toEqual([]);
  });

  test('a text query cannot reach across tenants either', async () => {
    const other = await body(await search(`other-${stamp}`, '?query=vector%20jobs'));
    expect(other.data?.messages).toEqual([]);
  });
});
