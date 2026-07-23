/**
 * Unit tests for oracle_reflect: default single-doc behavior is unchanged;
 * count > 1 returns a digest grouped by shared concept tags.
 */
import { describe, it, expect } from 'bun:test';
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../db/schema.ts';
import { handleReflect } from '../reflect.ts';
import type { ToolContext } from '../types.ts';

const SCHEMA_SQL = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  concepts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  superseded_by TEXT,
  superseded_at INTEGER,
  superseded_reason TEXT,
  status TEXT NOT NULL DEFAULT 'current',
  valid_from INTEGER,
  valid_until INTEGER,
  origin TEXT,
  project TEXT,
  created_by TEXT,
  trace_id TEXT
);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61');
`;

function makeCtx(): ToolContext {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    repoRoot: '/tmp',
    vectorStore: null as unknown as ToolContext['vectorStore'],
    vectorStatus: 'unknown',
    version: 'test',
  };
}

function seedDoc(ctx: ToolContext, id: string, concepts: string[], content: string) {
  const now = Date.now();
  ctx.db.insert(schema.oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${id}.md`,
    concepts: JSON.stringify(concepts),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  ctx.sqlite.prepare(`INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)`).run(id, content, concepts.join(' '));
}

async function payloadOf(ctx: ToolContext, input: { count?: number } = {}) {
  const res = await handleReflect(ctx, input);
  return JSON.parse(res.content[0].text);
}

describe('handleReflect — default (no count)', () => {
  it('returns a single principle, unchanged shape', async () => {
    const ctx = makeCtx();
    seedDoc(ctx, 'doc-1', ['trust'], 'trust content');
    const payload = await payloadOf(ctx);
    expect(payload.principle).toBeDefined();
    expect(payload.principle.id).toBe('doc-1');
    expect(payload.digest).toBeUndefined();
  });

  it('throws when the knowledge base is empty', async () => {
    const ctx = makeCtx();
    await expect(handleReflect(ctx, {})).rejects.toThrow('No documents found');
  });
});

describe('handleReflect — count > 1 (digest)', () => {
  it('groups docs that share a concept tag', async () => {
    const ctx = makeCtx();
    seedDoc(ctx, 'doc-1', ['trust', 'safety'], 'a');
    seedDoc(ctx, 'doc-2', ['trust'], 'b');
    seedDoc(ctx, 'doc-3', ['unrelated'], 'c');

    const payload = await payloadOf(ctx, { count: 3 });
    expect(payload.digest.returned).toBe(3);
    const trustGroup = payload.digest.groups.find((g: any) => g.concept === 'trust');
    expect(trustGroup).toBeDefined();
    expect(trustGroup.docs.map((d: any) => d.id).sort()).toEqual(['doc-1', 'doc-2']);
    expect(payload.digest.ungrouped.map((d: any) => d.id)).toContain('doc-3');
  });

  it('clamps count to 10 max', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 12; i++) seedDoc(ctx, `doc-${i}`, ['tag'], `content ${i}`);
    const payload = await payloadOf(ctx, { count: 50 });
    expect(payload.digest.requested).toBe(10);
    expect(payload.digest.returned).toBeLessThanOrEqual(10);
  });

  it('falls back gracefully when fewer docs exist than requested', async () => {
    const ctx = makeCtx();
    seedDoc(ctx, 'doc-1', ['solo'], 'only one');
    const payload = await payloadOf(ctx, { count: 5 });
    expect(payload.digest.returned).toBe(1);
    expect(payload.digest.ungrouped).toHaveLength(1);
  });
});
