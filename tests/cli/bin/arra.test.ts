import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const BIN_ENTRY = join(REPO_ROOT, 'bin/arra.ts');

async function runBin(args: string[]) {
  const proc = Bun.spawn(['bun', 'run', BIN_ENTRY, ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe('arra bin argument hardening', () => {
  test('documents mcp read-only usage in help', async () => {
    const result = await runBin(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('arra-oracle mcp [--read-only]');
    expect(result.stdout).toContain('arra-oracle mine <dir> [--watch]');
  });

  test('delegates mine help without starting the server', async () => {
    const result = await runBin(['mine', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: arra mine <dir>');
  });

  test('rejects unknown mcp options before importing server code', async () => {
    const result = await runBin(['mcp', '--bogus']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown mcp option: --bogus');
    expect(result.stdout).toContain('arra-oracle mcp [--read-only]');
  });

  test('rejects unknown serve flags and bad port values', async () => {
    const badFlag = await runBin(['serve', '--bogus']);
    const badPort = await runBin(['serve', '--port', 'abc']);

    expect(badFlag.code).toBe(1);
    expect(badFlag.stderr).toContain('unknown serve option: --bogus');
    expect(badFlag.stdout).toContain('Serve options:');
    expect(badPort.code).toBe(1);
    expect(badPort.stderr).toContain('--port requires a numeric value');
  });

  test('serve wrapper starts the HTTP server', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'arra-bin-serve-'));
    const port = 49100 + Math.floor(Math.random() * 500);
    const proc = Bun.spawn(['bun', 'run', BIN_ENTRY, 'serve', '--port', String(port)], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ORACLE_DATA_DIR: dataDir,
        ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
        ORACLE_FILE_WATCHER: '0',
        ORACLE_PORT: String(port),
        PORT: String(port),
      },
    });

    try {
      await waitForHealth(proc, port);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited.catch(() => undefined);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('published bin aliases', () => {
  test('exposes arra and arra-oracle commands for global installs', async () => {
    const pkg = await import('../../../package.json');
    expect(pkg.default.bin.arra).toBe('./cli/src/cli.ts');
    expect(pkg.default.bin['arra-oracle']).toBe('./bin/arra.ts');
  });
});

async function waitForHealth(proc: Bun.Subprocess<'pipe', 'pipe', 'inherit'>, port: number) {
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {}
    const exited = await Promise.race([proc.exited, Bun.sleep(0).then(() => null)]);
    if (exited !== null) throw new Error(`serve wrapper exited early with code ${exited}`);
    await Bun.sleep(250);
  }
  throw new Error('serve wrapper did not become healthy');
}
