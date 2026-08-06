import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

describe('GET /api/docs', () => {
  test('serves Swagger UI and augmented OpenAPI at the canonical API version', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'arra-docs-test-'));
    const port = String(await freePort());
    const proc = Bun.spawn(['bun', 'src/server.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: join(scratch, 'home'),
        ORACLE_PORT: port,
        ORACLE_DATA_DIR: join(scratch, 'data'),
        ORACLE_DB_PATH: join(scratch, 'data', 'oracle.db'),
        ORACLE_REPO_ROOT: join(scratch, 'repo'),
        ARRA_API_TOKEN: 'test-token',
        ORACLE_EMBEDDER: 'none',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    try {
      const response = await waitForOk(`http://127.0.0.1:${port}/api/docs`, 'manual');
      const ui = await waitForOk(`http://127.0.0.1:${port}/api/v1/docs`);
      const specResponse = await waitForOk(`http://127.0.0.1:${port}/api/v1/docs/json`);
      const spec = await specResponse.json();

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(`http://127.0.0.1:${port}/api/v1/docs`);
      expect(await ui.text()).toContain('SwaggerUIBundle');
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.paths['/api/health'].get.summary).toBeDefined();
      expect(spec.paths['/api/health'].get.responses['200'].content['application/json'].example).toBeDefined();
    } finally {
      proc.kill('SIGTERM');
      await Promise.race([proc.exited, Bun.sleep(3000)]);
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});

async function waitForOk(url: string, redirect: RequestRedirect = 'follow'): Promise<Response> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect });
      if (response.ok || response.status === 308) return response;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`server did not serve ${url}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('failed to allocate port'));
      server.close(() => resolve(address.port));
    });
  });
}
