import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import { oracleDocuments } from '../../db/schema.ts';
import { runWithTenant } from '../../middleware/tenant.ts';
import type { ToolContext } from '../types.ts';
import { handleConcepts } from '../concepts.ts';
import { handleInbox } from '../inbox.ts';
import { handleList } from '../list.ts';
import { handleRead } from '../read.ts';
import { handleSearch } from '../search.ts';
import { handleStats } from '../stats.ts';
import { handleSupersede, runSupersede } from '../supersede.ts';

const tempRoots: string[] = [];

function tempRoot(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function makeCtx(): ToolContext {
  const repoRoot = tempRoot('arra-tools-repo-');
  const dbPath = path.join(tempRoot('arra-tools-db-'), 'oracle.db');
  const { sqlite, db } = createDatabase(dbPath);
  const now = Date.now();

  db.insert(oracleDocuments).values([
    {
      id: 'doc-principle',
      type: 'principle',
      sourceFile: 'ψ/principles/nothing.md',
      concepts: JSON.stringify(['oracle', 'safety']),
      createdAt: now - 1000,
      updatedAt: now - 1000,
      indexedAt: now - 1000,
      project: 'github.com/soul/arra',
    },
    {
      id: 'doc-learning',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/vector.md',
      concepts: JSON.stringify(['vector', 'adapter', 'oracle']),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      project: 'github.com/soul/arra',
    },
  ]).run();

  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('doc-principle', 'Nothing is Deleted\nKeep append-only history.', 'oracle safety');
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('doc-learning', 'Vector adapters switch per collection.', 'vector adapter oracle');

  return {
    db,
    sqlite,
    repoRoot,
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test-version',
  };
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('backend MCP tools unit coverage', () => {
  test('handleConcepts counts JSON and comma concepts with type filter', async () => {
    const ctx = makeCtx();

    const all = parse(await handleConcepts(ctx, { limit: 10, type: 'all' }));
    expect(all.total_unique).toBe(4);
    expect(all.concepts.find((c: any) => c.name === 'oracle').count).toBe(2);

    const learning = parse(await handleConcepts(ctx, { limit: 5, type: 'learning' }));
    expect(learning.filter_type).toBe('learning');
    expect(learning.concepts.map((c: any) => c.name)).toContain('adapter');
    expect(learning.concepts.map((c: any) => c.name)).not.toContain('safety');
  });

  test('handleList paginates and validates filters', async () => {
    const ctx = makeCtx();

    const all = parse(await handleList(ctx, { type: 'all', limit: 10, offset: 0 }));
    expect(all.total).toBe(2);
    expect(all.documents).toHaveLength(2);
    expect(all.documents[0].id).toBe('doc-learning');

    const filtered = parse(await handleList(ctx, { type: 'principle', limit: 10, offset: 0 }));
    expect(filtered.total).toBe(1);
    expect(filtered.documents[0].type).toBe('principle');

    await expect(handleList(ctx, { type: 'all', limit: 0, offset: 0 })).rejects.toThrow('limit must be between');
    await expect(handleList(ctx, { type: 'bad' as never, limit: 10, offset: 0 })).rejects.toThrow('Invalid type');
  });

  test('handleList tolerates malformed concept metadata', async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.insert(oracleDocuments).values({
      id: 'doc-bad-concepts',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/bad-concepts.md',
      concepts: 'not-json, fallback',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
    }).run();
    ctx.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run('doc-bad-concepts', 'Malformed concepts should not crash list.', 'not-json fallback');

    const all = parse(await handleList(ctx, { type: 'all', limit: 10, offset: 0 }));
    const doc = all.documents.find((item: any) => item.id === 'doc-bad-concepts');
    expect(doc.concepts).toEqual(['not-json', 'fallback']);
  });

  test('handleStats returns counts, FTS health, vector status, and version', async () => {
    const ctx = makeCtx();

    const stats = parse(await handleStats(ctx, {}));
    expect(stats.total_documents).toBe(2);
    expect(stats.by_type).toEqual({ learning: 1, principle: 1 });
    expect(stats.fts_indexed).toBe(2);
    expect(stats.unique_concepts).toBe(4);
    expect(stats.vector_status).toBe('connected');
    expect(stats.version).toBe('test-version');
  });

  test('tenant context scopes document-backed MCP reads', async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.insert(oracleDocuments).values({
      id: 'tenant-b-secret',
      tenantId: 'tenant-b',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/tenant-b.md',
      concepts: JSON.stringify(['private']),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
    }).run();
    ctx.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run('tenant-b-secret', 'tenant exclusive secret phrase', 'private');

    const hidden = parse(await runWithTenant('tenant-a', () =>
      handleSearch(ctx, { query: 'tenant exclusive secret phrase', mode: 'fts', limit: 10 })));
    expect(hidden.results).toHaveLength(0);

    const visible = parse(await runWithTenant('tenant-b', () => handleStats(ctx, {})));
    expect(visible.total_documents).toBe(1);
    expect(visible.tenant.id).toBe('tenant-b');
  });

  test('handleRead resolves direct files, id lookup, FTS fallback, and not-found errors', async () => {
    const ctx = makeCtx();
    const directFile = path.join(ctx.repoRoot, 'ψ/principles/nothing.md');
    fs.mkdirSync(path.dirname(directFile), { recursive: true });
    fs.writeFileSync(directFile, '# Nothing is Deleted\nappend-only');

    const direct = parse(await handleRead(ctx, { file: 'ψ/principles/nothing.md' }));
    expect(direct.source).toBe('file');
    expect(direct.content).toContain('append-only');

    const byId = parse(await handleRead(ctx, { id: 'doc-principle' }));
    expect(byId.source).toBe('file');
    expect(byId.project).toBe('github.com/soul/arra');

    const fallback = parse(await handleRead(ctx, { id: 'doc-learning' }));
    expect(fallback.source).toBe('fts_cache');
    expect(fallback.content).toContain('Vector adapters');

    const missing = await handleRead(ctx, { id: 'missing' });
    expect(missing.isError).toBe(true);
    expect(parse(missing).error).toContain('Document not found');

    const usage = await handleRead(ctx, {});
    expect(usage.isError).toBe(true);
    expect(parse(usage).error).toContain('Provide file or id');
  });

  test('handleInbox lists handoff files newest first with previews and pagination', async () => {
    const ctx = makeCtx();
    const dir = path.join(ctx.repoRoot, 'ψ/inbox/handoff');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-06-06_01-00_old.md'), 'old handoff');
    fs.writeFileSync(path.join(dir, '2026-06-07_02-00_new.md'), 'new handoff'.repeat(80));

    const first = parse(await handleInbox(ctx, { type: 'handoff', limit: 1, offset: 0 }));
    expect(first.total).toBe(2);
    expect(first.files).toHaveLength(1);
    expect(first.files[0].filename).toContain('new');
    expect(first.files[0].preview.length).toBeLessThanOrEqual(500);

    const second = parse(await handleInbox(ctx, { type: 'all', limit: 1, offset: 1 }));
    expect(second.files[0].filename).toContain('old');

    await expect(handleInbox(ctx, null as never)).rejects.toThrow('inbox input must be an object');
    await expect(handleInbox(ctx, { type: 'bad' as never, limit: 1, offset: 0 })).rejects.toThrow('Invalid inbox type');
    await expect(handleInbox(ctx, { type: 'all', limit: 0, offset: 0 })).rejects.toThrow('limit must be between');
  });

  test('runSupersede validates inputs and handleSupersede marks the old document', async () => {
    const ctx = makeCtx();

    expect(runSupersede(ctx.db, null as never).isError).toBe(true);
    expect(runSupersede(ctx.db, { oldId: '', newId: 'doc-learning' }).isError).toBe(true);
    expect(runSupersede(ctx.db, { oldId: 'doc-principle', newId: '' }).isError).toBe(true);
    expect(runSupersede(ctx.db, { oldId: 'doc-principle', newId: 'doc-principle' }).isError).toBe(true);

    const response = parse(await handleSupersede(ctx, {
      oldId: 'doc-principle',
      newId: 'doc-learning',
      reason: 'newer vector note',
    }));
    expect(response.success).toBe(true);
    expect(response.old_id).toBe('doc-principle');
    expect(response.new_id).toBe('doc-learning');

    const row = ctx.sqlite.prepare('SELECT superseded_by, superseded_reason FROM oracle_documents WHERE id = ?')
      .get('doc-principle') as { superseded_by: string; superseded_reason: string };
    expect(row.superseded_by).toBe('doc-learning');
    expect(row.superseded_reason).toBe('newer vector note');
  });
});
