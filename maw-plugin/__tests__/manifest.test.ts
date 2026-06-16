import { expect, test } from 'bun:test';
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
