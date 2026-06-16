import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-no-avx-'));
const repoRoot = path.join(tmpRoot, 'repo');
const dataDir = path.join(tmpRoot, 'data');

const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalVectorUrl = process.env.VECTOR_URL;
const originalVectorDb = process.env.ORACLE_VECTOR_DB;
const originalForceAvx = process.env.ARRA_FORCE_AVX;

process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
delete process.env.VECTOR_URL;
process.env.ORACLE_VECTOR_DB = 'lancedb';
process.env.ARRA_FORCE_AVX = '0';

const warnMessages: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnMessages.push(args.map(String).join(' '));
};

const { handleLearn, handleSearch } = await import('../handlers.ts');

describe('handleSearch local vector on non-AVX CPU', () => {
  test('vector mode falls back to FTS instead of touching native vector adapter', async () => {
    handleLearn('noavxunique deploy blocker should still be searchable through fts fallback', 'test', ['noavxunique']);

    const result = await handleSearch('noavxunique', 'all', 5, 0, 'vector');

    expect(result.mode).toBe('vector');
    expect(result.vectorAvailable).toBe(false);
    expect(result.warning).toContain('CPU lacks AVX');
    expect(result.warning).toContain('FTS5-only');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].source).toBe('fts');
    expect(warnMessages.some((msg) => msg.includes('Local vector search disabled'))).toBe(true);
  });

  test('hybrid mode also degrades to FTS with a warning', async () => {
    const result = await handleSearch('noavxunique', 'all', 5, 0, 'hybrid');

    expect(result.mode).toBe('hybrid');
    expect(result.vectorAvailable).toBe(false);
    expect(result.warning).toContain('CPU lacks AVX');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.source === 'fts')).toBe(true);
  });
});

afterAll(() => {
  console.warn = originalWarn;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalRepoRoot !== undefined) process.env.ORACLE_REPO_ROOT = originalRepoRoot;
  else delete process.env.ORACLE_REPO_ROOT;
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath !== undefined) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
  if (originalVectorDb !== undefined) process.env.ORACLE_VECTOR_DB = originalVectorDb;
  else delete process.env.ORACLE_VECTOR_DB;
  if (originalForceAvx !== undefined) process.env.ARRA_FORCE_AVX = originalForceAvx;
  else delete process.env.ARRA_FORCE_AVX;
});
