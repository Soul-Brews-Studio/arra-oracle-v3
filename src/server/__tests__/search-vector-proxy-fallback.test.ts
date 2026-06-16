import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-vector-proxy-fallback-'));
const dataDir = path.join(tmpRoot, 'data');
const dbPath = path.join(dataDir, 'oracle.db');

const remote = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return Response.json({ error: 'remote vector down' }, { status: 503 });
    if (url.pathname === '/api/vector/health') return Response.json({ status: 'down', engines: [], checked_at: new Date().toISOString() });
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

function runFallbackInFreshProcess() {
  const script = `
    const { handleLearn, handleSearch } = await import('./src/server/handlers.ts');
    handleLearn('cloudproxy1378 local fts ground truth survives remote vector outage', 'test', ['cloudproxy1378']);
    const result = await handleSearch('cloudproxy1378', 'all', 5, 0, 'hybrid');
    console.log('RESULT_JSON:' + JSON.stringify(result));
  `;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: dbPath,
      ORACLE_REPO_ROOT: tmpRoot,
      VECTOR_URL: `http://127.0.0.1:${remote.port}`,
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
    results: Array<{ content: string }>;
    vectorAvailable?: boolean;
    warning?: string;
  };
}

describe('handleSearch cloud vector proxy fallback', () => {
  test('keeps local FTS as ground truth when remote vector proxy is down', async () => {
    const result = runFallbackInFreshProcess();

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toContain('cloudproxy1378');
    expect(result.vectorAvailable).toBe(false);
    expect(result.warning).toBe('Vector proxy unavailable — FTS5-only results');
  });
});

afterAll(() => {
  remote.stop(true);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
