import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { smokeInstall } from '../../../tools/maw-plugin-arra/scripts/install-smoke.ts';

const tmp = mkdtempSync(join(tmpdir(), 'maw-plugin-arra-install-smoke-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('install smoke extracts tgz and invokes the installed handler', async () => {
  const result = await smokeInstall({ root: join(import.meta.dir, '../../../tools/maw-plugin-arra'), workDir: tmp, keep: true });

  expect(result.manifestName).toBe('arra');
  expect(result.entry).toBe('./index.js');
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.installDir).toEndWith('/installed/arra');
  expect(result.output).toContain('maw arra');
  expect(result.output).toContain('vector-config');
});
