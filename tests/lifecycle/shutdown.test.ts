import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

describe('graceful shutdown', () => {
  test('SIGTERM drains health before exiting cleanly', async () => {
    const fixture = await startServer();
    try {
      const ready = await fetch(`${fixture.baseUrl}/api/health`);
      expect(ready.status).toBe(200);

      fixture.process.kill('SIGTERM');
      const draining = await waitForDrainingHealth(fixture);
      expect(draining.status).toBe(503);
      expect(draining.body.status).toBe('draining');

      const exitCode = await Promise.race([
        fixture.process.exited,
        sleep(5_000).then(() => 'timeout' as const),
      ]);
      expect(exitCode).toBe(0);
    } finally {
      await fixture.stop();
    }
  }, 15_000);
});

type Spawned = ReturnType<typeof Bun.spawn>;

interface ServerFixture {
  baseUrl: string;
  process: Spawned;
  stop: () => Promise<void>;
}

async function startServer(): Promise<ServerFixture> {
  const root = mkdtempSync(join(tmpdir(), 'arra-shutdown-'));
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  const repoRoot = join(root, 'repo');
  mkdirSync(home); mkdirSync(dataDir); mkdirSync(repoRoot);
  const port = await freePort();
  const proc = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
      ORACLE_REPO_ROOT: repoRoot,
      ORACLE_EMBEDDER: 'none',
      ORACLE_VECTOR_HEALTH_TIMEOUT: '50',
      ARRA_SHUTDOWN_MIN_DRAIN_MS: '1000',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const fixture = { baseUrl: `http://127.0.0.1:${port}`, process: proc };
  try {
    await waitForHealth(fixture);
  } catch (error) {
    proc.kill('SIGKILL');
    await proc.exited.catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : error}\n${await stdout}\n${await stderr}`);
  }
  return {
    ...fixture,
    stop: async () => {
      proc.kill('SIGKILL');
      await proc.exited.catch(() => undefined);
      await Promise.all([stdout.catch(() => ''), stderr.catch(() => '')]);
      rmSync(root, { recursive: true });
    },
  };
}

async function waitForHealth(fixture: Omit<ServerFixture, 'stop'>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await hasExited(fixture.process)) throw new Error('server exited before health was ready');
    try {
      const res = await fetch(`${fixture.baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not become healthy');
}

async function waitForDrainingHealth(fixture: ServerFixture): Promise<{ status: number; body: any }> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${fixture.baseUrl}/api/health`);
      if (res.status === 503) return { status: res.status, body: await res.json() };
    } catch {}
    await sleep(50);
  }
  throw new Error('health did not report draining before shutdown');
}

async function hasExited(proc: Spawned): Promise<boolean> {
  return await Promise.race([proc.exited.then(() => true), sleep(0).then(() => false)]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
