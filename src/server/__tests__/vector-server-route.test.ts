import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-server-route-data-'));
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-server-route-repo-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;

const { createVectorServerApp } = await import('../../vector-server.ts');

describe('vector-server route surface', () => {
  it('serves /api/search as the VECTOR_URL gateway target', async () => {
    const app = createVectorServerApp();
    const response = await app.handle(new Request('http://localhost/api/search'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Missing query parameter: q');
  });
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalRepoRoot) process.env.ORACLE_REPO_ROOT = originalRepoRoot;
  else delete process.env.ORACLE_REPO_ROOT;
});
