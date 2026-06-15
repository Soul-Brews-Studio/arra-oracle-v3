import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNestedPlugin } from '../../../src/routes/plugins/model.ts';

let tmp = '';
let dir = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-model-'));
  dir = join(tmp, 'server-missing-wasm');
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('readNestedPlugin server manifest with missing wasm', () => {
  test('keeps the server plugin listed when wasm is absent', () => {
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'server-missing-wasm',
      version: '1.0.0',
      entry: './index.ts',
      wasm: 'missing.wasm',
      server: { command: 'bun', args: ['server.ts'] },
    }));
    expect(readNestedPlugin(dir, 'server-missing-wasm')).toMatchObject({
      name: 'server-missing-wasm',
      file: '',
      server: { command: 'bun', args: ['server.ts'] },
    });
  });
});
