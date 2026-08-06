import { describe, expect, test } from 'bun:test';
import { normalizeUnifiedPluginManifest } from '../../../src/plugins/unified-manifest.ts';

describe('server.args manifest validation', () => {
  test('rejects non-string args entries', () => {
    expect(() => normalizeUnifiedPluginManifest({
      name: 'bad-server-args',
      version: '1.0.0',
      entry: './index.ts',
      server: { command: 'bun', args: ['ok', 1] },
    })).toThrow('server.args');
  });
});
