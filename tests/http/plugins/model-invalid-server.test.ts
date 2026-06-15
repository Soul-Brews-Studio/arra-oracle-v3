import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNestedPlugin } from '../../../src/routes/plugins/model.ts';

let tmp = '';
let dir = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-model-'));
  dir = join(tmp, 'invalid-server');
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('readNestedPlugin invalid server manifest', () => {
  test('skips server-only plugins when server validation fails', () => {
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'invalid-server',
      version: '1.0.0',
      entry: './index.ts',
      server: { command: '' },
    }));
    expect(readNestedPlugin(dir, 'invalid-server')).toBeNull();
  });
});
