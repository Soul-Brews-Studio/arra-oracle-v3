import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-forum-hardening-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { forumApi } = await import('../../../src/routes/forum/index.ts');

function request(pathname: string, init: RequestInit = {}) {
  return forumApi.handle(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  }));
}

async function jsonRequest(pathname: string, init: RequestInit = {}) {
  const response = await request(pathname, init);
  return { response, json: await response.json() as Record<string, any> };
}

async function postThread(body: Record<string, unknown>) {
  return jsonRequest('/api/thread', { method: 'POST', body: JSON.stringify(body) });
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbModule.closeDb();
  restore('ORACLE_DATA_DIR', previousData);
  restore('ORACLE_DB_PATH', previousDb);
  fs.rmSync(tempData, { recursive: true });
});

test('forum create route rejects blank content and invalid continuation inputs', async () => {
  expect((await postThread({ message: '   ' })).response.status).toBe(400);
  expect((await postThread({ message: 'hello', role: 'robot' })).response.status).toBe(400);
  expect((await postThread({ message: 'hello', thread_id: 'not-a-thread' })).response.status).toBe(400);
});

test('forum routes trim content, coerce string thread ids, and reject bad ids', async () => {
  const created = await postThread({ message: '  first message  ', title: '  Trimmed title  ' });
  expect(created.response.status).toBe(200);
  const threadId = created.json.thread_id as number;

  const appended = await postThread({ message: ' second ', thread_id: String(threadId), role: 'human' });
  expect(appended.response.status).toBe(200);
  expect(appended.json.thread_id).toBe(threadId);

  const read = await jsonRequest(`/api/thread/${threadId}`);
  expect(read.response.status).toBe(200);
  expect(read.json.thread.title).toBe('Trimmed title');
  expect(read.json.messages.map((message: { content: string }) => message.content)).toEqual(['first message', 'second']);

  expect((await request('/api/thread/1abc')).status).toBe(400);
  expect((await request('/api/thread/0')).status).toBe(400);
});

test('forum list and status routes validate status and pagination', async () => {
  const created = await postThread({ message: 'status target' });
  const threadId = created.json.thread_id as number;

  expect((await jsonRequest(`/api/thread/${threadId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  })).response.status).toBe(400);

  const closed = await jsonRequest(`/api/thread/${threadId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: ' closed ' }),
  });
  expect(closed.response.status).toBe(200);
  expect(closed.json.status).toBe('closed');

  expect((await request('/api/threads?status=done')).status).toBe(400);
  expect((await request('/api/threads?limit=abc')).status).toBe(400);
  expect((await request('/api/threads?offset=-1')).status).toBe(400);
});
