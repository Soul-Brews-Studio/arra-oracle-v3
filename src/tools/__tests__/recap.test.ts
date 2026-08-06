import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import { oracleDocuments } from '../../db/schema.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import { handleRecap } from '../recap.ts';
import type { ToolContext } from '../types.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];

function tempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function makeCtx(): ToolContext {
  const connection = createDatabase(path.join(tempRoot('arra-recap-'), 'oracle.db'));
  connections.push(connection);
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-recap-repo-'),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test-version',
  };
}

function insertDoc(ctx: ToolContext, input: {
  id: string; project?: string; content: string; usage?: number; concepts?: string[]; updatedOffset?: number;
}) {
  const now = Date.now();
  ctx.db.insert(oracleDocuments).values({
    id: input.id,
    type: 'learning',
    sourceFile: `docs/${input.project ?? 'misc'}/${input.id}.md`,
    concepts: JSON.stringify(input.concepts ?? []),
    createdAt: now - (input.updatedOffset ?? 0),
    updatedAt: now - (input.updatedOffset ?? 0),
    indexedAt: now - (input.updatedOffset ?? 0),
    project: input.project,
    usageCount: input.usage ?? 0,
    lastAccessedAt: input.usage ? now - 60_000 : null,
  }).run();
  ctx.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(input.id, input.content, (input.concepts ?? []).join(','));
}

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('oracle_recap emits identity and top memories grouped by project', async () => {
  const ctx = makeCtx();
  insertDoc(ctx, { id: 'alpha-hot', project: 'alpha', usage: 12, concepts: ['deploy'], content: 'Alpha deploy runbook. Use docker run then arra mine.' });
  insertDoc(ctx, { id: 'alpha-cold', project: 'alpha', usage: 0, concepts: ['old'], content: 'Old alpha note.', updatedOffset: 90 * 86_400_000 });
  insertDoc(ctx, { id: 'beta-hot', project: 'beta', usage: 5, concepts: ['search'], content: 'Beta search memory. Query with oracle_search first.' });

  const text = (await handleRecap(ctx, { limit: 3, maxTokens: 300 })).content[0].text;

  expect(text).toContain('Oracle wake-up context');
  expect(text).toContain('arra-oracle-v3 vtest-version');
  expect(text).toContain('## alpha');
  expect(text).toContain('## beta');
  expect(text.indexOf('alpha-hot')).toBeLessThan(text.indexOf('alpha-cold'));
  expect(text).toContain('heat');
  expect(text).toContain('http://localhost:47778/simple');
  expect(tokens(text)).toBeLessThanOrEqual(300);
});

test('oracle_recap handles an empty knowledge base cheaply', async () => {
  const ctx = makeCtx();
  const text = (await handleRecap(ctx, { maxTokens: 220 })).content[0].text;

  expect(text).toContain('No memories indexed yet');
  expect(text).toContain('oracle_learn');
  expect(text).toContain('/simple');
  expect(tokens(text)).toBeLessThanOrEqual(220);
});
