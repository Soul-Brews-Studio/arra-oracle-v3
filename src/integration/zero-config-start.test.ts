/**
 * Zero-config start integration coverage (#1370).
 *
 * A fresh install should boot and answer FTS-backed search requests before any
 * vector DB/index has been created. Vector/hybrid requests quietly degrade to
 * FTS instead of opening/creating LanceDB during request handling.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

let serverProcess: Subprocess | null = null;
let tmpRoot = '';
let baseUrl = '';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(maxAttempts = 40): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await Bun.sleep(250);
  }
  throw new Error('zero-config test server failed to start');
}

async function getJson(pathname: string): Promise<{ res: Response; data: any }> {
  const res = await fetch(`${baseUrl}${pathname}`);
  const data = await res.json();
  return { res, data };
}

describe('zero-config start without vector index', () => {
  beforeAll(async () => {
    const repoRoot = path.resolve(import.meta.dir, '../..');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-zero-config-'));
    const dataDir = path.join(tmpRoot, 'data');
    const repoDataRoot = path.join(tmpRoot, 'empty-repo');
    fs.mkdirSync(repoDataRoot, { recursive: true });

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    const env = {
      ...process.env,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'),
      ORACLE_REPO_ROOT: repoDataRoot,
      ORACLE_VECTOR_DB: 'lancedb',
      ORACLE_CHROMA_TIMEOUT: '1000',
      ORACLE_VECTOR_HEALTH_TIMEOUT: '1000',
      VECTOR_URL: '',
    };

    serverProcess = Bun.spawn(['bun', 'run', 'src/server.ts'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });

    await waitForServer();
  }, 20_000);

  afterAll(() => {
    serverProcess?.kill();
    serverProcess = null;
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('boots fresh and serves FTS search without creating a vector index', async () => {
    const health = await getJson('/api/health');
    expect(health.res.ok).toBe(true);
    expect(health.data.status).toBe('ok');

    const stats = await getJson('/api/stats');
    expect(stats.res.ok).toBe(true);
    expect(typeof stats.data.total).toBe('number');

    const fts = await getJson('/api/search?q=zero-config&mode=fts');
    expect(fts.res.ok).toBe(true);
    expect(Array.isArray(fts.data.results)).toBe(true);
    expect(fts.data).not.toHaveProperty('vectorAvailable');

    const lancedbDir = path.join(tmpRoot, 'data', 'lancedb');
    expect(fs.existsSync(lancedbDir)).toBe(false);
  }, 15_000);

  test('quietly degrades hybrid and vector modes to FTS when vector index is absent', async () => {
    for (const mode of ['hybrid', 'vector'] as const) {
      const { res, data } = await getJson(`/api/search?q=zero-config&mode=${mode}`);
      expect(res.ok).toBe(true);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.mode).toBe(mode);
      expect(data.vectorAvailable).toBe(false);
      expect(data).not.toHaveProperty('warning');
    }

    const lancedbDir = path.join(tmpRoot, 'data', 'lancedb');
    expect(fs.existsSync(lancedbDir)).toBe(false);
  }, 15_000);
});
