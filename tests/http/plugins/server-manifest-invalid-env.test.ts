import { describe, expect, test } from 'bun:test';
import { normalizeUnifiedPluginManifest } from '../../../src/plugins/unified-manifest.ts';

describe('server.env manifest validation', () => {
  test('rejects non-string env values', () => {
    expect(() => normalizeUnifiedPluginManifest({
      name: 'bad-server-env',
      version: '1.0.0',
      entry: './index.ts',
      server: { command: 'bun', env: { PORT: 47778 } },
    })).toThrow('server.env');
  });
});
