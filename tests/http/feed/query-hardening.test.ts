import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedMawUrl = process.env.MAW_JS_URL;
const root = mkdtempSync(join(tmpdir(), 'feed-hardening-'));
process.env.ORACLE_DATA_DIR = root;

const maw = Bun.serve({
  port: 0,
  fetch() {
    return Response.json({ events: [] });
  },
});
process.env.MAW_JS_URL = String(maw.url).replace(/\/$/, '');

const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { createFeedRoute } = await import('../../../src/routes/feed/create.ts');
const { listFeedRoute } = await import('../../../src/routes/feed/list.ts');

const feedApp = new Elysia({ prefix: '/api/feed' }).use(createFeedRoute).use(listFeedRoute);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `feed-hardening-${stamp}`;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function feedRequest(path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => feedApp.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function postFeed(oracle: string, message = oracle) {
  return feedRequest('/api/feed', {
    method: 'POST',
    body: JSON.stringify({ oracle, event: 'notice', project: tenantId, session_id: oracle, message }),
  });
}

afterAll(() => {
  maw.stop();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('MAW_JS_URL', savedMawUrl);
  rmSync(root, { recursive: true });
});

test('/api/feed bounds unsafe limits and preserves delimiter-heavy messages', async () => {
  const sharedOracle = `limit-${stamp}`;
  const delimiterOracle = `delimiter-${stamp}`;
  await postFeed(sharedOracle, 'one');
  await postFeed(sharedOracle, 'two');
  await postFeed(sharedOracle, 'three');
  await postFeed(delimiterOracle, 'message with | pipe and » marker');

  const invalidLimit = await feedRequest(`/api/feed?limit=-5&oracle=${encodeURIComponent(sharedOracle)}`);
  const singleLimit = await feedRequest(`/api/feed?limit=1&oracle=${encodeURIComponent(sharedOracle)}`);
  const delimiter = await feedRequest(`/api/feed?oracle=${encodeURIComponent(delimiterOracle)}`);
  const invalidBody = await invalidLimit.json() as { events: Array<{ oracle: string }> };
  const singleBody = await singleLimit.json() as { events: Array<{ oracle: string }> };
  const delimiterBody = await delimiter.json() as { events: Array<{ message: string }> };

  expect(invalidLimit.status).toBe(200);
  expect(invalidBody.events).toHaveLength(3);
  expect(singleBody.events).toHaveLength(1);
  expect(delimiterBody.events).toHaveLength(1);
  expect(delimiterBody.events[0]?.message).toBe('message with | pipe and » marker');
});

test('/api/feed rejects blank required fields and compacts line-injection input', async () => {
  const oracle = `newline-${stamp}`;
  const bad = await feedRequest('/api/feed', {
    method: 'POST',
    body: JSON.stringify({ oracle: '   ', event: 'notice' }),
  });
  expect(bad.status).toBe(400);

  const created = await feedRequest('/api/feed', {
    method: 'POST',
    body: JSON.stringify({
      oracle,
      event: 'notice | bad',
      project: 'project » marker',
      session_id: 's\n1',
      message: 'hello\nthere with | pipe and » marker',
    }),
  });
  expect(created.status).toBe(200);

  const listed = await feedRequest(`/api/feed?oracle=${encodeURIComponent(oracle)}`);
  const body = await listed.json() as { events: Array<{ event: string; project: string; session_id: string; message: string }> };
  expect(body.events[0]).toMatchObject({
    event: 'notice bad',
    project: 'project marker',
    session_id: 's 1',
    message: 'hello there with | pipe and » marker',
  });
});
