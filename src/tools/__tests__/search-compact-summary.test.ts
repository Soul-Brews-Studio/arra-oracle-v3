import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import { oracleDocuments } from '../../db/schema.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import type { ToolContext } from '../types.ts';
import { handleSearch } from '../search.ts';

const tempRoots: string[] = [];
const connections: DatabaseConnection[] = [];

function tempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function makeCtx(): ToolContext {
  const dbPath = path.join(tempRoot('arra-mcp-compact-'), 'oracle.db');
  const connection = createDatabase(dbPath);
  connections.push(connection);
  const now = Date.now();
  connection.db.insert(oracleDocuments).values({
    id: 'compact-summary-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/learnings/compact-summary.md',
    concepts: JSON.stringify(['token-economy', 'retrieval']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('compact-summary-doc', longMemory(), 'token economy retrieval');
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-mcp-compact-repo-'),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test-version',
  };
}

function longMemory(): string {
  return [
    '# Compact Retrieval',
    'Background context should not dominate a compact answer. '.repeat(5),
    'Phoenix token economy retrieval returns a distilled memory snippet with enough evidence to decide whether oracle_read is needed.',
    'A long tail detail about unrelated migrations, UI shells, and deployment notes should stay out of the compact payload. '.repeat(4),
  ].join('\n\n');
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('oracle_search compact-summary returns token-light snippets with provenance', async () => {
  const ctx = makeCtx();
  const full = parse(await handleSearch(ctx, { query: 'phoenix token economy', mode: 'fts', limit: 1 }));
  const compact = parse(await handleSearch(ctx, {
    query: 'phoenix token economy',
    mode: 'fts',
    limit: 1,
    retrieval: 'compact-summary',
  }));

  const result = compact.results[0];
  expect(result).toMatchObject({
    id: 'compact-summary-doc',
    compact: true,
    source_file: 'ψ/memory/learnings/compact-summary.md',
    provenance: { source: 'fts', source_file: 'ψ/memory/learnings/compact-summary.md' },
  });
  expect(result.content.length).toBeLessThanOrEqual(240);
  expect(result.summary.length).toBeLessThanOrEqual(180);
  expect(result.content).toContain('Phoenix token economy');
  expect(result.summary).toContain('Phoenix token economy');
  expect(full.results[0].content.length).toBeGreaterThan(result.content.length);
  expect(compact.metadata.retrieval).toMatchObject({
    mode: 'compact-summary',
    maxContentChars: 240,
    maxSummaryChars: 180,
  });
  expect(compact.metadata.retrieval.savedContentChars).toBeGreaterThan(0);
  expect(compact.metadata.retrieval.savingsRatio).toBeGreaterThan(0);
});

test('oracle_search rejects unknown retrieval modes', async () => {
  await expect(handleSearch(makeCtx(), {
    query: 'phoenix token economy',
    mode: 'fts',
    retrieval: 'tiny' as never,
  })).rejects.toThrow('Invalid retrieval mode');
});
