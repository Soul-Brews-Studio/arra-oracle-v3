import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-vector-proxy-fallback-'));
const dataDir = path.join(tmpRoot, 'data');
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalVectorUrl = process.env.VECTOR_URL;

const remote = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return Response.json({ error: 'remote vector down' }, { status: 503 });
    if (url.pathname === '/api/vector/health') return Response.json({ status: 'down', engines: [], checked_at: new Date().toISOString() });
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.VECTOR_URL = `http://127.0.0.1:${remote.port}`;

const { handleLearn, handleSearch } = await import('../handlers.ts');

describe('handleSearch cloud vector proxy fallback', () => {
  test('keeps local FTS as ground truth when remote vector proxy is down', async () => {
    handleLearn('cloudproxy1378 local fts ground truth survives remote vector outage', 'test', ['cloudproxy1378']);

    const result = await handleSearch('cloudproxy1378', 'all', 5, 0, 'hybrid');

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toContain('cloudproxy1378');
    expect(result.vectorAvailable).toBe(false);
    expect(result.warning).toBe('Vector proxy unavailable — FTS5-only results');
  });
});

afterAll(() => {
  remote.stop(true);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath !== undefined) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
});
