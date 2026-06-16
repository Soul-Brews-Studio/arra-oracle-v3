import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

describe('OpenAPI export', () => {
  test('writes a valid spec from the Elysia Swagger docs endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arra-openapi-test-'));
    try {
      const out = join(dir, 'openapi.json');
      const port = String(await freePort());
      const proc = Bun.spawn(
        ['bun', 'scripts/export-openapi.ts', '--port', port, '--out', out, '--spec-path', '/api/openapi.json'],
        {
          cwd: REPO_ROOT,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(`${stdout}\n${stderr}`).toContain('openapi: 3.0.3');
      expect(code).toBe(0);

      const spec = JSON.parse(await readFile(out, 'utf8'));
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Arra Oracle API');
      expect(spec.paths['/api/health']).toBeDefined();
      expect(spec.paths['/api/docs/json']).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true });
    }
  }, 30_000);
});

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
