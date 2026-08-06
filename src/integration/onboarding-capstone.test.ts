/**
 * End-to-end onboarding capstone smoke.
 *
 * Covers the intended first-run path: fresh zero-config server, FTS recall,
 * explicit learning write, vector still disabled/FTS-degraded, then deliberate
 * vector-section opt-in via /api/vector/config.
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
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error('onboarding capstone server failed to start');
}

async function json(pathname: string, init?: RequestInit): Promise<{ res: Response; data: any }> {
  const res = await fetch(`${baseUrl}${pathname}`, init);
  const data = await res.json();
  return { res, data };
}

describe('onboarding capstone smoke', () => {
  beforeAll(async () => {
    const repoRoot = path.resolve(import.meta.dir, '../..');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-onboarding-capstone-'));
    const dataDir = path.join(tmpRoot, 'data');
    const repoDataRoot = path.join(tmpRoot, 'vault');
    fs.mkdirSync(repoDataRoot, { recursive: true });

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = Bun.spawn(['bun', 'run', 'src/server.ts'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ORACLE_PORT: String(port),
        ORACLE_DATA_DIR: dataDir,
        ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'),
        ORACLE_REPO_ROOT: repoDataRoot,
        ORACLE_VECTOR_DB: 'lancedb',
        ORACLE_CHROMA_TIMEOUT: '1000',
        ORACLE_VECTOR_HEALTH_TIMEOUT: '1000',
        VECTOR_URL: '',
      },
    });

    await waitForServer();
  }, 20_000);

  afterAll(() => {
    serverProcess?.kill();
    serverProcess = null;
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('fresh FTS → learn → vector disabled degradation → explicit vector opt-in', async () => {
    const health = await json('/api/health');
    expect(health.res.ok).toBe(true);
    expect(health.data.status).toBe('ok');

    const initialFts = await json('/api/search?q=capstoneunique&mode=fts');
    expect(initialFts.res.ok).toBe(true);
    expect(Array.isArray(initialFts.data.results)).toBe(true);
    expect(initialFts.data).not.toHaveProperty('vectorAvailable');

    const initialVectorConfig = await json('/api/vector/config');
    expect(initialVectorConfig.res.ok).toBe(true);
    expect(initialVectorConfig.data.enabled).toBe(false);
    expect(initialVectorConfig.data.state).toMatchObject({ enabled: false, ready: false });

    const learn = await json('/api/learn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pattern: 'capstoneunique onboarding smoke proves learned docs are FTS searchable before vectors',
        source: 'onboarding-capstone-test',
        concepts: ['onboarding', 'capstone'],
      }),
    });
    expect(learn.res.ok).toBe(true);
    expect(learn.data.success).toBe(true);

    const learnedFts = await json('/api/search?q=capstoneunique&mode=fts');
    expect(learnedFts.res.ok).toBe(true);
    expect(learnedFts.data.results.some((r: any) => r.id === learn.data.id)).toBe(true);

    for (const mode of ['hybrid', 'vector'] as const) {
      const degraded = await json(`/api/search?q=capstoneunique&mode=${mode}`);
      expect(degraded.res.ok).toBe(true);
      expect(degraded.data.mode).toBe(mode);
      expect(degraded.data.vectorAvailable).toBe(false);
      expect(degraded.data.warning).toBeUndefined();
      expect(degraded.data.results.some((r: any) => r.id === learn.data.id)).toBe(true);
    }

    const enabled = await json('/api/vector/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.res.ok).toBe(true);
    expect(enabled.data.enabled).toBe(true);
    expect(enabled.data.state.enabled).toBe(true);
    expect(enabled.data.state.ready).toBe(false);
    expect(enabled.data.state.recommendedAction).toBe('POST /api/vector/index/start');
  }, 30_000);
});
