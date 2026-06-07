import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mcp-vector-guard-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalVectorEnabled = process.env.ORACLE_VECTOR_ENABLED;

process.env.ORACLE_DATA_DIR = path.join(tmp, 'data');
process.env.ORACLE_DB_PATH = path.join(tmp, 'data', 'oracle.db');
delete process.env.ORACLE_VECTOR_ENABLED;

const { createDatabase, closeDb } = await import('../../db/index.ts');
const { oracleDocuments } = await import('../../db/schema.ts');
const { handleSearch } = await import('../search.ts');

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function makeCtx() {
  const { sqlite, db } = createDatabase(process.env.ORACLE_DB_PATH);
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id: 'mcp-vector-disabled-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/learnings/mcp-vector-disabled.md',
    concepts: JSON.stringify(['mcp', 'vector', 'guard']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: null,
  }).run();
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('mcp-vector-disabled-doc', 'MCP vector disabled guard falls back to FTS without touching vector search.', 'mcp vector guard');

  return {
    db,
    sqlite,
    repoRoot: tmp,
    vectorStore: {
      name: 'must-not-be-called',
      query: () => { throw new Error('vector query should be skipped when vector section is disabled'); },
    } as any,
    vectorStatus: 'unavailable' as const,
    version: 'test-version',
  };
}

afterAll(() => {
  try { closeDb(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
  if (originalVectorEnabled === undefined) delete process.env.ORACLE_VECTOR_ENABLED;
  else process.env.ORACLE_VECTOR_ENABLED = originalVectorEnabled;
});

describe('MCP muninn_search vector section guard', () => {
  test('hybrid mode skips vector and returns FTS metadata when vector section is disabled', async () => {
    const ctx = makeCtx();
    const body = parse(await handleSearch(ctx, { query: 'MCP vector disabled guard', mode: 'hybrid', limit: 5 }));

    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('fts');
    expect(body.metadata.vectorAvailable).toBe(false);
    expect(body.metadata.vectorMatches).toBe(0);
    expect(body.metadata.ftsMatches).toBe(1);
  });

  test('vector mode also falls back to FTS when vector section is disabled', async () => {
    const ctx = makeCtx();
    const body = parse(await handleSearch(ctx, { query: 'MCP vector disabled guard', mode: 'vector', limit: 5 }));

    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('fts');
    expect(body.metadata.mode).toBe('vector');
    expect(body.metadata.vectorAvailable).toBe(false);
    expect(body.metadata.vectorMatches).toBe(0);
  });
});
