import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-forum-lib-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');

const dbModule = await import('../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const forum = await import('../../src/forum/handler.ts');

afterAll(() => {
  dbModule.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  if (fs.existsSync(tempData)) fs.rmSync(tempData, { recursive: true });
});

test('forum lib trims direct writes and preserves zero message metadata', () => {
  const thread = forum.createThread('  Direct title  ', '  tester  ', '  project/repo  ');
  const message = forum.addMessage(thread.id, 'oracle', '  content  ', {
    author: '  oracle  ',
    principlesFound: 0,
    patternsFound: 0,
    searchQuery: '  q  ',
  });
  const stored = forum.getMessages(thread.id)[0];

  expect(thread).toMatchObject({ title: 'Direct title', createdBy: 'tester', project: 'project/repo' });
  expect(message).toMatchObject({ content: 'content', author: 'oracle', principlesFound: 0, patternsFound: 0, searchQuery: 'q' });
  expect(stored).toMatchObject({ principlesFound: 0, patternsFound: 0 });
});

test('forum lib rejects invalid direct input before mutating threads', async () => {
  const before = forum.listThreads().total;

  expect(() => forum.createThread('   ')).toThrow('Thread title must not be blank');
  expect(() => forum.addMessage(0, 'human', 'hello')).toThrow('Thread 0 not found');
  await expect(forum.handleThreadMessage({ message: ' ', role: 'human' })).rejects.toThrow('Message content must not be blank');
  await expect(forum.handleThreadMessage({ message: 'hello', threadId: 0 })).rejects.toThrow('Invalid thread ID');

  expect(forum.listThreads().total).toBe(before);
});

test('forum lib validates runtime enum and pagination edge cases', () => {
  const thread = forum.createThread('runtime guards');

  expect(() => forum.updateThreadStatus(thread.id, 'archived' as any)).toThrow('Invalid thread status');
  expect(() => forum.addMessage(thread.id, 'robot' as any, 'hello')).toThrow('Invalid message role');
  expect(() => forum.listThreads({ status: 'archived' as any })).toThrow('Invalid thread status');
  expect(() => forum.listThreads({ limit: -1 })).toThrow('limit must be an integer between 1 and 100');
  expect(() => forum.listThreads({ offset: 1.5 })).toThrow('offset must be an integer between 0 and 10000');
  expect(forum.listThreads({ limit: 1_000 }).threads.length).toBeLessThanOrEqual(100);
});
