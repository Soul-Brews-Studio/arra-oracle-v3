import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-forum-db-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { forumApi } = await import('../../../src/routes/forum/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const threadIds: number[] = [];

function requestForum(tenantId: string, pathname: string, init: RequestInit = {}) {
  return createTenantFetch((request) => forumApi.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function createThread(tenantId: string, title: string) {
  const res = await requestForum(tenantId, '/api/thread', {
    method: 'POST',
    body: JSON.stringify({ message: title, title }),
  });
  const body = await res.json() as { thread_id: number };
  expect(res.status).toBe(200);
  threadIds.push(body.thread_id);
  return body.thread_id;
}

async function threadTitles(tenantId: string) {
  const res = await requestForum(tenantId, '/api/threads');
  const body = await res.json() as { threads: Array<{ title: string }> };
  expect(res.status).toBe(200);
  return body.threads.map((thread) => thread.title);
}

afterAll(() => {
  for (const id of threadIds) {
    dbModule.sqlite.prepare('DELETE FROM forum_messages WHERE thread_id = ?').run(id);
    dbModule.sqlite.prepare('DELETE FROM forum_threads WHERE id = ?').run(id);
  }
  dbModule.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  fs.rmSync(tempData, { recursive: true, force: true });
});

test('forum routes list and read only the selected tenant threads', async () => {
  const titleA = `tenant A forum ${stamp}`;
  const titleB = `tenant B forum ${stamp}`;
  const threadA = await createThread(tenantA, titleA);
  const threadB = await createThread(tenantB, titleB);

  expect(await threadTitles(tenantA)).toContain(titleA);
  expect(await threadTitles(tenantA)).not.toContain(titleB);
  expect((await requestForum(tenantA, `/api/thread/${threadA}`)).status).toBe(200);
  expect((await requestForum(tenantA, `/api/thread/${threadB}`)).status).toBe(404);
});

test('forum routes reject cross-tenant updates and follow-up messages', async () => {
  const threadB = threadIds[1] ?? await createThread(tenantB, `tenant B guarded ${stamp}`);
  const beforeCount = messageCount(threadB);

  const deniedMessage = await requestForum(tenantA, '/api/thread', {
    method: 'POST',
    body: JSON.stringify({ thread_id: threadB, message: `cross tenant append ${stamp}` }),
  });
  expect(deniedMessage.status).toBe(404);
  expect(messageCount(threadB)).toBe(beforeCount);

  const deniedStatus = await requestForum(tenantA, `/api/thread/${threadB}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'closed' }),
  });
  expect(deniedStatus.status).toBe(404);
});

function messageCount(threadId: number): number {
  const row = dbModule.sqlite.prepare('SELECT COUNT(*) AS count FROM forum_messages WHERE thread_id = ?')
    .get(threadId) as { count: number };
  return row.count;
}
