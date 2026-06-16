import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlugin } from '../scripts/build.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-maw-plugin-build-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('maw plugin build emits dist manifest, tgz, sha, and plugins.lock', async () => {
  const result = await buildPlugin({ root: join(import.meta.dir, '..'), outDir: tmp });
  const entry = join(tmp, 'index.js');
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as {
    entry: string;
    artifact: { path: string; sha256: string };
  };
  const lock = JSON.parse(readFileSync(result.lockPath, 'utf8')) as {
    plugins: { arra: { version: string; package: string; packageSha256: string; artifact: { sha256: string }; pinned: boolean } };
  };
  const sha256 = createHash('sha256').update(readFileSync(entry)).digest('hex');
  const packageSha256 = createHash('sha256').update(readFileSync(result.tgzPath)).digest('hex');

  expect(manifest.entry).toBe('./index.js');
  expect(manifest.artifact).toEqual({ path: './index.js', sha256 });
  expect(result.sha256).toBe(sha256);
  expect(result.packageSha256).toBe(packageSha256);
  expect(existsSync(result.tgzPath)).toBe(true);
  expect(lock.plugins.arra).toMatchObject({ version: '1.0.0', package: 'arra-1.0.0.tgz', pinned: true });
  expect(lock.plugins.arra.artifact.sha256).toBe(sha256);
  expect(lock.plugins.arra.packageSha256).toBe(packageSha256);
});
