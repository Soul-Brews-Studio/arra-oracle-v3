import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNestedPlugin } from '../../../src/routes/plugins/model.ts';

let tmp = '';
let dir = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-model-'));
  dir = join(tmp, 'server-only');
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('readNestedPlugin server-only manifest', () => {
  test('returns a plugin entry without wasm bytes', () => {
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'server-only',
      version: '1.0.0',
      entry: './index.ts',
      server: { command: 'bun', healthPath: '/ready' },
    }));
    expect(readNestedPlugin(dir, 'server-only')).toMatchObject({
      name: 'server-only',
      file: '',
      server: { command: 'bun', healthPath: '/ready' },
    });
  });
});
