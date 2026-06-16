import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-vector-proxy-'));
const dataDir = path.join(tmpRoot, 'data');
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalVectorUrl = process.env.VECTOR_URL;

const fakeVector = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/search') return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({
      results: [{
        id: 'remote-vector-1',
        type: 'learning',
        content: 'Remote vector result',
        source_file: 'vault/remote.md',
        concepts: [],
        source: 'vector',
        score: 0.91,
      }],
      total: 42,
      offset: 0,
      limit: 1,
      mode: 'vector',
      vectorAvailable: true,
    });
  },
});

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
process.env.VECTOR_URL = `http://127.0.0.1:${fakeVector.port}`;

const warnMessages: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnMessages.push(args.map(String).join(' '));
};

// Dynamic import after env is set because config/db/handlers freeze env at module load.
const { handleSearch } = await import('../handlers.ts');

describe('handleSearch VECTOR_URL proxy totals', () => {
  test('uses remote vector total without opening local vector stats in core proxy mode', async () => {
    const result = await handleSearch('oracle', 'all', 1, 0, 'vector');

    expect(result.total).toBe(42);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('remote-vector-1');
    expect(result.vectorAvailable).toBe(true);
    expect(warnMessages.some((msg) => msg.includes('[Hybrid] getStats for vector-only total failed'))).toBe(false);
  });
});

afterAll(() => {
  fakeVector.stop(true);
  console.warn = originalWarn;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath !== undefined) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
});
