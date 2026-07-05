import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-vector-proxy-'));
const dataDir = path.join(tmpRoot, 'data');
const dbPath = path.join(dataDir, 'oracle.db');

function runSearchInFreshProcess() {
  const script = `
    const warnMessages = [];
    console.warn = (...args) => warnMessages.push(args.map(String).join(' '));
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname !== '/api/search') return Response.json({ error: 'unexpected proxy call' }, { status: 404 });
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
    };
    const { handleSearch } = await import('./src/server/handlers.ts');
    const result = await handleSearch('oracle', 'all', 1, 0, 'vector');
    console.log('RESULT_JSON:' + JSON.stringify({ result, warnMessages }));
  `;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: dbPath,
      ORACLE_REPO_ROOT: tmpRoot,
      VECTOR_URL: 'http://127.0.0.1:9',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  if (proc.exitCode !== 0) throw new Error(stderr || stdout);
  const line = stdout.split('\n').reverse().find((item) => item.startsWith('RESULT_JSON:'));
  if (!line) throw new Error(`Missing RESULT_JSON marker.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  return JSON.parse(line.slice('RESULT_JSON:'.length)) as {
    result: { total: number; results: Array<{ id: string }>; vectorAvailable?: boolean };
    warnMessages: string[];
  };
}

describe('handleSearch VECTOR_URL proxy totals', () => {
  test('uses remote vector total without opening local vector stats in core proxy mode', async () => {
    const { result, warnMessages } = runSearchInFreshProcess();

    expect(result.total).toBe(42);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('remote-vector-1');
    expect(result.vectorAvailable).toBe(true);
    expect(warnMessages.some((msg) => msg.includes('[Hybrid] getStats for vector-only total failed'))).toBe(false);
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
