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
  const dbPath = path.join(tempRoot('arra-mcp-search-supersede-'), 'oracle.db');
  const connection = createDatabase(dbPath);
  connections.push(connection);
  const now = Date.now();
  connection.db.insert(oracleDocuments).values([{
    id: 'old-supersede-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/old.md',
    concepts: JSON.stringify(['supersede']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    supersededBy: 'new-supersede-doc',
    supersededAt: now - 1000,
    supersededReason: 'newer MCP memory',
  }, {
    id: 'new-supersede-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/new.md',
    concepts: JSON.stringify(['supersede']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }]).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('old-supersede-doc', 'legacy supersede unique mcp result', 'supersede');
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-mcp-search-repo-'),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test-version',
  };
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('oracle_search includes inline supersede successor fields', async () => {
  const ctx = makeCtx();
  const body = parse(await handleSearch(ctx, {
    query: 'legacy supersede unique',
    mode: 'fts',
    limit: 5,
  }));

  expect(body.results).toHaveLength(1);
  expect(body.results[0]).toMatchObject({
    id: 'old-supersede-doc',
    superseded_by: 'new-supersede-doc',
    superseded_reason: 'newer MCP memory',
    confidence: { level: 'medium' },
    provenance: { source: 'fts', source_file: 'ψ/memory/old.md' },
  });
  expect(body.results[0].confidence.signals).toContain('matched by keyword search');
  expect(body.results[0].superseded_at).toMatch(/T.*Z$/);
});
