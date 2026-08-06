import { afterAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-trace-route-repo-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-trace-route-data-'));
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;

process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');

const { traceCreateRoute } = await import('../../routes/traces/create.ts');
const { getTrace } = await import('../../trace/handler.ts');

describe('POST /api/traces', () => {
  it('creates a trace and returns the MCP-compatible summary shape', async () => {
    const app = new Elysia().use(traceCreateRoute);

    const response = await app.handle(new Request('http://localhost/api/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'phase 2 trace route smoke', scope: 'project', project: 'test/repo' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.trace_id).toBeString();
    expect(payload.summary.total_dig_points).toBeNumber();
    expect(getTrace(payload.trace_id)?.query).toBe('phase 2 trace route smoke');
  });

  it('rejects a missing query before writing', async () => {
    const app = new Elysia().use(traceCreateRoute);

    const response = await app.handle(new Request('http://localhost/api/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('query');
  });
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalRepoRoot) process.env.ORACLE_REPO_ROOT = originalRepoRoot;
  else delete process.env.ORACLE_REPO_ROOT;
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
});
