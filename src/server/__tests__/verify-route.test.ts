import { afterAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-verify-route-data-'));
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-verify-route-repo-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;

fs.mkdirSync(path.join(repoRoot, 'ψ/memory/learnings'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'ψ/memory/learnings/healthy.md'), '# Healthy\n');

const dbModule = await import('../../db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { db, oracleDocuments } = dbModule;
const { verifyRoutes } = await import('../../routes/verify/index.ts');

describe('GET/POST /api/verify', () => {
  it('reports disk-vs-index health and supports orphan flagging through HTTP', async () => {
    db.insert(oracleDocuments).values([
      {
        id: 'verify-healthy-1',
        type: 'learning',
        concepts: JSON.stringify(['verify']),
        sourceFile: 'ψ/memory/learnings/healthy.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        indexedAt: Date.now() + 10_000,
      },
      {
        id: 'verify-orphan-1',
        type: 'learning',
        concepts: JSON.stringify(['verify']),
        sourceFile: 'ψ/memory/learnings/missing.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        indexedAt: Date.now(),
      },
    ]).run();

    const app = new Elysia().use(verifyRoutes);
    const checkResponse = await app.handle(new Request('http://localhost/api/verify?type=learning'));
    const checkPayload = await checkResponse.json();

    expect(checkResponse.status).toBe(200);
    expect(checkPayload.counts.healthy).toBe(1);
    expect(checkPayload.counts.orphaned).toBe(1);
    expect(checkPayload.orphaned).toContain('ψ/memory/learnings/missing.md');

    const fixResponse = await app.handle(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ check: false, type: 'learning' }),
    }));
    const fixPayload = await fixResponse.json();

    expect(fixResponse.status).toBe(200);
    expect(fixPayload.fixed_orphans).toBe(1);
  });
});

afterAll(() => {
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalRepoRoot) process.env.ORACLE_REPO_ROOT = originalRepoRoot;
  else delete process.env.ORACLE_REPO_ROOT;
  dbModule.resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});
