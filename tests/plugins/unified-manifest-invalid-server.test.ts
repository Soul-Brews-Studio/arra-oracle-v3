import { describe, expect, test } from 'bun:test';
import { normalizeUnifiedPluginManifest } from '../../src/plugins/unified-manifest.ts';

const base = { name: 'server-pack', version: '1.0.0', entry: './index.ts' };

describe('unified manifest server validation', () => {
  test('rejects malformed server launcher fields', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ ...base, server: { args: [] } }, /server.command/],
      [{ ...base, server: { command: 'bun', args: 'dev' } }, /server.args/],
      [{ ...base, server: { command: 'bun', env: { PORT: 123 } } }, /server.env/],
      [{ ...base, server: { command: 'bun', healthPath: 'health' } }, /server.healthPath/],
      [{ ...base, server: { command: 'bun', autostart: 'yes' } }, /server.autostart/],
      [{ ...base, lifecycle: { init: 1 } }, /lifecycle.init/],
      [{ ...base, lifecycle: { destroy: 1 } }, /lifecycle.destroy/],
      [{ ...base, lifecycle: { start: 'yes' } }, /lifecycle.start/],
      [{ ...base, lifecycle: { stop: 'yes' } }, /lifecycle.stop/],
    ];

    for (const [manifest, message] of cases) {
      expect(() => normalizeUnifiedPluginManifest(manifest)).toThrow(message);
    }
  });
});
