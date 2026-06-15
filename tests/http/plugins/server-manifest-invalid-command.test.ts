import { describe, expect, test } from 'bun:test';
import { normalizeUnifiedPluginManifest } from '../../../src/plugins/unified-manifest.ts';

describe('server.command manifest validation', () => {
  test('rejects empty server commands', () => {
    expect(() => normalizeUnifiedPluginManifest({
      name: 'bad-server-command',
      version: '1.0.0',
      entry: './index.ts',
      server: { command: '' },
    })).toThrow('server.command');
  });
});
