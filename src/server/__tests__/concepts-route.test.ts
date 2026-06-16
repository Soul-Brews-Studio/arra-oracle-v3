import { afterAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-concepts-route-data-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');

const { db, oracleDocuments } = await import('../../db/index.ts');
const { conceptsRoutes } = await import('../../routes/concepts/index.ts');

describe('GET /api/concepts', () => {
  it('lists concept tags with counts and type filtering', async () => {
    db.insert(oracleDocuments).values([
      {
        id: 'concepts-learning-1',
        type: 'learning',
        title: 'Learning 1',
        content: 'one',
        concepts: JSON.stringify(['alpha', 'shared']),
        sourceFile: 'ψ/memory/learnings/concepts-learning-1.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        indexedAt: Date.now(),
      },
      {
        id: 'concepts-retro-1',
        type: 'retro',
        title: 'Retro 1',
        content: 'two',
        concepts: JSON.stringify(['shared']),
        sourceFile: 'ψ/memory/retrospectives/concepts-retro-1.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        indexedAt: Date.now(),
      },
    ]).run();

    const app = new Elysia().use(conceptsRoutes);
    const allResponse = await app.handle(new Request('http://localhost/api/concepts?limit=5'));
    const allPayload = await allResponse.json();
    const learningResponse = await app.handle(new Request('http://localhost/api/concepts?type=learning&limit=5'));
    const learningPayload = await learningResponse.json();

    expect(allResponse.status).toBe(200);
    expect(allPayload.concepts).toContainEqual({ name: 'shared', count: 2 });
    expect(allPayload.total_unique).toBeGreaterThanOrEqual(2);
    expect(learningResponse.status).toBe(200);
    expect(learningPayload.concepts).toContainEqual({ name: 'alpha', count: 1 });
    expect(learningPayload.concepts).toContainEqual({ name: 'shared', count: 1 });
    expect(learningPayload.filter_type).toBe('learning');
  });
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
});
