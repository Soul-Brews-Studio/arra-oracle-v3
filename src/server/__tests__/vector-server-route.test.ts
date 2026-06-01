import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-server-route-data-'));
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-server-route-repo-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
const originalVectorUrl = process.env.VECTOR_URL;
const originalVectorServer = process.env.ORACLE_VECTOR_SERVER;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.VECTOR_URL = 'http://127.0.0.1:9';
process.env.ORACLE_VECTOR_SERVER = '1';

const { createVectorServerApp } = await import('../../vector-server.ts');

describe('vector-server route surface', () => {
  it('serves /api/search as the VECTOR_URL gateway target', async () => {
    const app = createVectorServerApp();
    const response = await app.handle(new Request('http://localhost/api/search'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Missing query parameter: q');
  });

  it('ignores inherited VECTOR_URL instead of proxying its own vector health route', async () => {
    const app = createVectorServerApp();
    const response = await app.handle(new Request('http://localhost/api/vector/health'));
    const payload = await response.json() as Record<string, unknown>;

    // If the sidecar honored VECTOR_URL, this would take the proxy path and
    // include { proxy: "http://127.0.0.1:9" }. The sidecar must always answer
    // from its local vector adapter surface to avoid loops.
    expect(payload.proxy).toBeUndefined();
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
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
  if (originalVectorServer !== undefined) process.env.ORACLE_VECTOR_SERVER = originalVectorServer;
  else delete process.env.ORACLE_VECTOR_SERVER;
});
