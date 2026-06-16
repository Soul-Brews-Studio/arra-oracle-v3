import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import {
  db,
  forumMessages,
  forumThreads,
  learnLog,
  oracleDocuments,
  traceLog,
} from '../../../src/db/index.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const author = `oracle-audit-${stamp}`;
const session = `session-audit-${stamp}`;
const source = `learn-audit-${stamp}`;
const project = `project-audit-${stamp}`;
const docId = `doc-audit-${stamp}`;
const traceId = `trace-audit-${stamp}`;

const now = Date.now();
const thread = db.insert(forumThreads).values({
  title: 'coverage oracle activity',
  createdBy: 'test',
  createdAt: now,
  updatedAt: now,
}).returning().get();

db.insert(forumMessages).values({
  threadId: thread.id,
  role: 'oracle',
  content: 'coverage message',
  author,
  createdAt: now,
}).run();

db.insert(traceLog).values({
  traceId,
  query: 'coverage trace',
  sessionId: session,
  createdAt: now,
  updatedAt: now,
}).run();

db.insert(learnLog).values({
  documentId: docId,
  patternPreview: 'coverage learn',
  source,
  concepts: '[]',
  createdAt: now,
  project,
}).run();

db.insert(oracleDocuments).values({
  id: docId,
  type: 'learning',
  sourceFile: `ψ/memory/learnings/${docId}.md`,
  concepts: '[]',
  createdAt: now,
  updatedAt: now,
  indexedAt: now,
  project,
}).run();

afterAll(() => {
  db.delete(forumMessages).where(eq(forumMessages.threadId, thread.id)).run();
  db.delete(forumThreads).where(eq(forumThreads.id, thread.id)).run();
  db.delete(traceLog).where(eq(traceLog.traceId, traceId)).run();
  db.delete(learnLog).where(eq(learnLog.documentId, docId)).run();
  db.delete(oracleDocuments).where(eq(oracleDocuments.id, docId)).run();
});

test('GET /api/oracles aggregates active identities and projects', async () => {
  const app = createHealthRoutes({
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  const res = await app.handle(new Request('http://local/api/oracles?hours=1'));
  const body = await res.json() as Record<string, any>;
  const names = body.identities.map((identity: { oracle_name: string }) => identity.oracle_name);

  expect(res.status).toBe(200);
  expect(names).toContain(author);
  expect(names).toContain(session);
  expect(names).toContain(source);
  expect(body.projects.map((item: { project: string }) => item.project)).toContain(project);
  expect(body.window_hours).toBe(1);
});


test('GET /api/oracles/thor exposes the dev-research Stormforge profile', async () => {
  const app = createHealthRoutes({
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  const res = await app.handle(new Request('http://local/api/oracles/thor'));
  const body = await res.json() as Record<string, any>;
  const capabilities = body.capabilities.map((item: { id: string }) => item.id);

  expect(res.status).toBe(200);
  expect(body.id).toBe('thor-oracle');
  expect(body.name).toBe('Thor Oracle');
  expect(body.role).toBe('dev-research oracle');
  expect(body.theme).toBe('stormforge');
  expect(body.motto).toContain('ตีเหล็กจากพายุ');
  expect(capabilities).toContain('research-distillation');
  expect(capabilities).toContain('stormforge-development');
  expect(capabilities).toContain('system-thinking');
});
