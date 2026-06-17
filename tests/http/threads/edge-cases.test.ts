import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-thread-edge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const tenantMod = await import('../../../src/middleware/tenant.ts');
const { forumApi } = await import('../../../src/routes/forum/index.ts');

const tenantHandler = tenantMod.createTenantFetch((request) => forumApi.handle(request));

type JsonBody = Record<string, any>;

function request(pathname: string, init: RequestInit = {}) {
  return forumApi.handle(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
  }));
}

function tenantRequest(tenantId: string, pathname: string, init: RequestInit = {}) {
  return tenantHandler(new Request(`http://local${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      [tenantMod.TENANT_HEADER]: tenantId,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  }));
}

async function json(response: Response): Promise<JsonBody> {
  return await response.json() as JsonBody;
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('thread HTTP edge cases', () => {
  test('send/list/read/update stay scoped to the active tenant', async () => {
    const tenantA = 'thread-edge-a';
    const tenantB = 'thread-edge-b';
    const created = await tenantRequest(tenantA, '/api/thread', {
      method: 'POST',
      body: JSON.stringify({ message: 'tenant-scoped message', title: 'tenant scoped' }),
    });
    expect(created.status).toBe(200);
    const threadId = (await json(created)).thread_id as number;

    expect((await tenantRequest(tenantB, `/api/thread/${threadId}`)).status).toBe(404);
    const listB = await json(await tenantRequest(tenantB, '/api/threads?limit=5'));
    expect(listB.threads.map((thread: JsonBody) => thread.id)).not.toContain(threadId);

    const deniedUpdate = await tenantRequest(tenantB, `/api/thread/${threadId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(deniedUpdate.status).toBe(404);

    const updateA = await tenantRequest(tenantA, `/api/thread/${threadId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(updateA.status).toBe(200);
  });

  test('continuing a closed thread requires explicit reopen intent', async () => {
    const created = await request('/api/thread', {
      method: 'POST',
      body: JSON.stringify({ message: 'close me', title: 'closed gate' }),
    });
    const threadId = (await json(created)).thread_id as number;
    expect((await request(`/api/thread/${threadId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    })).status).toBe(200);

    const blocked = await request('/api/thread', {
      method: 'POST',
      body: JSON.stringify({ thread_id: threadId, message: 'should not reopen implicitly' }),
    });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error).toContain('reopen=true');

    const reopened = await request('/api/thread', {
      method: 'POST',
      body: JSON.stringify({ thread_id: String(threadId), message: 'explicit reopen', reopen: true }),
    });
    expect(reopened.status).toBe(200);
    expect((await json(reopened)).status).toBe('pending');

    const read = await json(await request(`/api/thread/${threadId}`));
    expect(read.messages.map((message: JsonBody) => message.content)).toEqual(['close me', 'explicit reopen']);
  });

  test('send/list/read/update reject malformed edge inputs', async () => {
    expect((await request('/api/thread', { method: 'POST', body: JSON.stringify({ message: '   ' }) })).status).toBe(400);
    expect((await request('/api/thread', { method: 'POST', body: JSON.stringify({ message: 'bad id', thread_id: 0 }) })).status).toBe(400);
    expect((await request('/api/thread', { method: 'POST', body: JSON.stringify({ message: 'missing id', thread_id: 999999 }) })).status).toBe(404);
    expect((await request('/api/threads?status=open')).status).toBe(400);
    expect((await request('/api/threads?limit=0')).status).toBe(400);
    expect((await request('/api/threads?offset=NaN')).status).toBe(400);
    expect((await request('/api/thread/not-a-number')).status).toBe(400);
    expect((await request('/api/thread/0/status', { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })).status).toBe(400);
    expect((await request('/api/thread/999999/status', { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })).status).toBe(404);
  });
});
