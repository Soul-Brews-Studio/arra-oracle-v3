import { afterAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-supersede-route-data-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');

const { db, oracleDocuments } = await import('../../db/index.ts');
const { supersedeRoutes } = await import('../../routes/supersede/index.ts');

describe('POST /api/supersede/document', () => {
  it('marks oracle_documents supersession using MCP semantics', async () => {
    const now = Date.now();
    db.insert(oracleDocuments).values([
      {
        id: 'supersede-old-1',
        type: 'learning',
        concepts: JSON.stringify(['supersede']),
        sourceFile: 'ψ/memory/learnings/supersede-old.md',
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      },
      {
        id: 'supersede-new-1',
        type: 'learning',
        concepts: JSON.stringify(['supersede']),
        sourceFile: 'ψ/memory/learnings/supersede-new.md',
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      },
    ]).run();

    const app = new Elysia().use(supersedeRoutes);
    const response = await app.handle(new Request('http://localhost/api/supersede/document', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldId: 'supersede-old-1', newId: 'supersede-new-1', reason: 'newer learning' }),
    }));
    const payload = await response.json();

    const oldDoc = db.select({ supersededBy: oracleDocuments.supersededBy, supersededReason: oracleDocuments.supersededReason })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'supersede-old-1'))
      .get();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.old_id).toBe('supersede-old-1');
    expect(payload.new_id).toBe('supersede-new-1');
    expect(oldDoc?.supersededBy).toBe('supersede-new-1');
    expect(oldDoc?.supersededReason).toBe('newer learning');
  });
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
});
