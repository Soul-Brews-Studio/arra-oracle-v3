import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-edge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { tracesApi } = await import('../../../src/routes/traces/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const traceA = `trace-edge-a-${stamp}`;
const traceB = `trace-edge-b-${stamp}`;
const cyclicTrace = `trace-edge-cycle-${stamp}`;
const brokenPrevTrace = `trace-edge-broken-prev-${stamp}`;
const missingPrevTrace = `trace-edge-missing-prev-${stamp}`;
const linkA = `trace-edge-link-a-${stamp}`;
const linkB = `trace-edge-link-b-${stamp}`;
const linkC = `trace-edge-link-c-${stamp}`;
const traceIds = [traceA, traceB, cyclicTrace, brokenPrevTrace, linkA, linkB, linkC];
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values([
  { traceId: traceA, query: `trace edge ${stamp} a`, status: 'raw', childTraceIds: '[]', createdAt: now, updatedAt: now },
  { traceId: traceB, query: `trace edge ${stamp} b`, status: 'distilled', childTraceIds: '[]', createdAt: now + 1, updatedAt: now + 1 },
  {
    traceId: cyclicTrace,
    query: `trace edge ${stamp} cyclic`,
    status: 'raw',
    parentTraceId: cyclicTrace,
    childTraceIds: JSON.stringify([cyclicTrace]),
    createdAt: now + 2,
    updatedAt: now + 2,
  },
  { traceId: brokenPrevTrace, query: `trace edge ${stamp} broken prev`, prevTraceId: missingPrevTrace, childTraceIds: '[]', createdAt: now + 3, updatedAt: now + 3 },
  { traceId: linkA, query: `trace edge ${stamp} link a`, childTraceIds: '[]', createdAt: now + 4, updatedAt: now + 4 },
  { traceId: linkB, query: `trace edge ${stamp} link b`, childTraceIds: '[]', createdAt: now + 5, updatedAt: now + 5 },
  { traceId: linkC, query: `trace edge ${stamp} link c`, childTraceIds: '[]', createdAt: now + 6, updatedAt: now + 6 },
]).run();

function request(pathname: string, init: RequestInit = {}) {
  return tracesApi.handle(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
  }));
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.db.delete(dbMod.traceLog).where(inArray(dbMod.traceLog.traceId, traceIds)).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('trace route edge cases', () => {
  test('GET /api/traces rejects unsafe pagination values', async () => {
    const res = await request(`/api/traces?query=${encodeURIComponent(stamp)}&limit=-1&offset=NaN`);
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('limit');
  });

  test('GET /api/traces rejects unsupported status filters', async () => {
    const res = await request('/api/traces?status=sideways');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('status');
  });

  test('GET /api/traces/:id/chain rejects bad direction and missing ids', async () => {
    const badDirection = await request(`/api/traces/${traceA}/chain?direction=sideways`);
    const missing = await request('/api/traces/not-found/chain');

    expect(badDirection.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  test('GET /api/traces/:id/chain terminates on cyclic parent and child links', async () => {
    const res = await request(`/api/traces/${cyclicTrace}/chain`);
    const body = await res.json() as { chain: Array<{ traceId: string }>; totalDepth: number };

    expect(res.status).toBe(200);
    expect(body.chain.map((trace) => trace.traceId)).toEqual([cyclicTrace]);
  });

  test('GET /api/traces/:id/linked-chain keeps the anchor when a prev link is stale', async () => {
    const res = await request(`/api/traces/${brokenPrevTrace}/linked-chain`);
    const body = await res.json() as { chain: Array<{ traceId: string }>; position: number };

    expect(res.status).toBe(200);
    expect(body.chain.map((trace) => trace.traceId)).toEqual([brokenPrevTrace]);
    expect(body.position).toBe(0);
  });

  test('link/unlink routes reject duplicate, self, cycle, and missing-link edges', async () => {
    const linked = await request(`/api/traces/${linkA}/link`, {
      method: 'POST',
      body: JSON.stringify({ nextId: linkB }),
    });
    expect(linked.status).toBe(200);

    const duplicateNext = await request(`/api/traces/${linkA}/link`, {
      method: 'POST',
      body: JSON.stringify({ nextId: linkC }),
    });
    expect(duplicateNext.status).toBe(400);
    expect((await duplicateNext.json() as { error: string }).error).toContain('already has a next link');

    const duplicatePrev = await request(`/api/traces/${linkC}/link`, {
      method: 'POST',
      body: JSON.stringify({ nextId: linkB }),
    });
    expect(duplicatePrev.status).toBe(400);
    expect((await duplicatePrev.json() as { error: string }).error).toContain('already has a prev link');

    const selfLink = await request(`/api/traces/${linkC}/link`, {
      method: 'POST',
      body: JSON.stringify({ nextId: linkC }),
    });
    expect(selfLink.status).toBe(400);
    expect((await selfLink.json() as { error: string }).error).toContain('itself');

    const cycle = await request(`/api/traces/${linkB}/link`, {
      method: 'POST',
      body: JSON.stringify({ nextId: linkA }),
    });
    expect(cycle.status).toBe(400);
    expect((await cycle.json() as { error: string }).error).toContain('create a cycle');

    const missingLink = await request(`/api/traces/${linkC}/link?direction=next`, { method: 'DELETE' });
    expect(missingLink.status).toBe(400);
    expect((await missingLink.json() as { error: string }).error).toContain('No next link');

    const unlinked = await request(`/api/traces/${linkB}/link?direction=prev`, { method: 'DELETE' });
    expect(unlinked.status).toBe(200);

    const chain = await request(`/api/traces/${linkA}/linked-chain`);
    const body = await chain.json() as { chain: Array<{ traceId: string }> };
    expect(body.chain.map((trace) => trace.traceId)).toEqual([linkA]);
  });
});
