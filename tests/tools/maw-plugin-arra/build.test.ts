import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlugin } from '../../../tools/maw-plugin-arra/scripts/build.ts';

const tmp = mkdtempSync(join(tmpdir(), 'maw-plugin-arra-build-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('build emits an installable tgz, pinned lock, and runnable bundled handler', async () => {
  const result = await buildPlugin({ root: join(import.meta.dir, '../../../tools/maw-plugin-arra'), outDir: tmp });
  const entryPath = join(tmp, 'index.js');
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as {
    entry: string;
    artifact: { path: string; sha256: string };
  };
  const lock = JSON.parse(readFileSync(result.lockPath, 'utf8')) as {
    plugins: { arra: { version: string; package: string; pinned: boolean; artifact: { sha256: string } } };
  };
  const sha256 = createHash('sha256').update(readFileSync(entryPath)).digest('hex');
  const tar = spawnSync('tar', ['-tzf', result.tgzPath], { encoding: 'utf8' });
  const built = await import(`${pathToFileURL(entryPath).href}?${Date.now()}`) as {
    default: (ctx: { source?: string; args?: string[] }) => Promise<{ ok: boolean; output?: string }>;
  };
  const help = await built.default({ source: 'cli', args: ['help'] });

  expect(manifest.entry).toBe('./index.js');
  expect(manifest.artifact).toEqual({ path: './index.js', sha256 });
  expect(result.sha256).toBe(sha256);
  expect(existsSync(result.tgzPath)).toBe(true);
  expect(tar.status).toBe(0);
  expect(tar.stdout.trim().split('\n').sort()).toEqual(['index.js', 'plugin.json']);
  expect(lock.plugins.arra).toMatchObject({ version: '0.1.0', package: 'arra-0.1.0.tgz', pinned: true });
  expect(lock.plugins.arra.artifact.sha256).toBe(sha256);
  expect(help.ok).toBe(true);
  expect(help.output).toContain('maw arra');
});
