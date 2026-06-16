import { afterAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { randomUUID } from 'node:crypto';
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
    const oldId = `supersede-old-${randomUUID()}`;
    const newId = `supersede-new-${randomUUID()}`;
    db.insert(oracleDocuments).values([
      {
        id: oldId,
        type: 'learning',
        concepts: JSON.stringify(['supersede']),
        sourceFile: `ψ/memory/learnings/${oldId}.md`,
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      },
      {
        id: newId,
        type: 'learning',
        concepts: JSON.stringify(['supersede']),
        sourceFile: `ψ/memory/learnings/${newId}.md`,
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      },
    ]).run();

    const app = new Elysia().use(supersedeRoutes);
    const response = await app.handle(new Request('http://localhost/api/supersede/document', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldId, newId, reason: 'newer learning' }),
    }));
    const payload = await response.json();

    const oldDoc = db.select({ supersededBy: oracleDocuments.supersededBy, supersededReason: oracleDocuments.supersededReason })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, oldId))
      .get();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.old_id).toBe(oldId);
    expect(payload.new_id).toBe(newId);
    expect(oldDoc?.supersededBy).toBe(newId);
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
