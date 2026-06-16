import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-verify-tenant-data-'));
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-verify-tenant-repo-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { db, oracleDocuments } = dbModule;
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { verifyRoutes } = await import('../../../src/routes/verify/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `verify-a-${stamp}`;
const tenantB = `verify-b-${stamp}`;
const now = Date.now();
const paths = {
  aHealthy: `ψ/memory/learnings/verify-a-${stamp}.md`,
  bHealthy: `ψ/memory/learnings/verify-b-${stamp}.md`,
  bOrphan: `ψ/memory/learnings/verify-b-orphan-${stamp}.md`,
  unindexed: `ψ/memory/learnings/verify-unindexed-${stamp}.md`,
};

function writeRepoFile(relPath: string, content: string) {
  const fullPath = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function tenantRequest(tenantId: string, url: string, init: RequestInit = {}) {
  return createTenantFetch((request) => verifyRoutes.handle(request))(new Request(`http://local${url}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function seedDoc(id: string, tenantId: string, sourceFile: string) {
  db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    concepts: '[]',
    sourceFile,
    createdAt: now,
    updatedAt: now,
    indexedAt: now + 60_000,
    project: tenantId,
    createdBy: 'test',
  }).run();
}

writeRepoFile(paths.aHealthy, '# Tenant A\n');
writeRepoFile(paths.bHealthy, '# Tenant B\n');
writeRepoFile(paths.unindexed, '# Unindexed disk-only file\n');
seedDoc(`verify-a-${stamp}`, tenantA, paths.aHealthy);
seedDoc(`verify-b-${stamp}`, tenantB, paths.bHealthy);
seedDoc(`verify-b-orphan-${stamp}`, tenantB, paths.bOrphan);

test('GET /api/verify only reports DB-backed files for the active tenant', async () => {
  const res = await tenantRequest(tenantA, '/api/verify?type=learning');
  const body = await res.json() as {
    counts: { healthy: number; missing: number; orphaned: number; untracked: number };
    missing: string[];
    orphaned: string[];
    untracked: string[];
  };

  expect(res.status).toBe(200);
  expect(body.counts.healthy).toBe(1);
  expect(body.counts.missing).toBe(0);
  expect(body.orphaned).not.toContain(paths.bOrphan);
  expect(body.missing).not.toContain(paths.unindexed);
  expect(body.untracked).toEqual([]);
});

test('POST /api/verify check=false only flags orphaned docs in the active tenant', async () => {
  const res = await tenantRequest(tenantB, '/api/verify', {
    method: 'POST',
    body: JSON.stringify({ check: false, type: 'learning' }),
  });
  const body = await res.json() as { orphaned: string[]; fixed_orphans?: number };
  const orphan = db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, `verify-b-orphan-${stamp}`))
    .get();
  const tenantAHealthy = db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, `verify-a-${stamp}`))
    .get();

  expect(res.status).toBe(200);
  expect(body.orphaned).toContain(paths.bOrphan);
  expect(body.fixed_orphans).toBe(1);
  expect(orphan?.supersededBy).toBe('_verified_orphan');
  expect(tenantAHealthy?.supersededBy).toBeNull();
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
