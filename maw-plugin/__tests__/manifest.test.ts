import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../plugin.json' with { type: 'json' };

test('arra maw plugin declares modern dual surfaces and swappable backend config', () => {
  expect(manifest).toMatchObject({
    name: 'arra',
    entry: './index.ts',
    cli: { command: 'arra' },
    api: { path: '/api/arra' },
    config: { dbBackend: 'http', embedderBackend: 'none' },
  });
  expect(manifest.menu.map((item) => item.path)).toContain('/plugins/arra');
  expect(manifest.configSchema.properties.dbBackend.enum).toEqual(['http', 'sqlite', 'memory', 'custom']);
});

test('arra maw plugin records a verifiable entry artifact hash', () => {
  const entry = join(import.meta.dir, '..', manifest.artifact.path);
  const sha256 = createHash('sha256').update(readFileSync(entry)).digest('hex');

  expect(manifest.artifact).toEqual({ path: './index.ts', sha256 });
});
