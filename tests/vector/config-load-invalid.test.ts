import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadVectorConfig } from '../../src/vector/config.ts';
import { tempDir } from './helpers.ts';

test('vector config loader returns null for invalid JSON', () => {
  const fp = join(tempDir(), 'vector-server.json');
  writeFileSync(fp, '{not-json');
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    expect(loadVectorConfig(fp)).toBeNull();
  } finally {
    console.warn = originalWarn;
  }
});
