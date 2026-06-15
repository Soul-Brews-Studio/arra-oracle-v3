import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CUSTOM_MENU_FILE } from '../../../src/menu/custom-store.ts';
import { createMenuApp, requestJson } from './_helpers.ts';

let original: string | null;

function clearFile() {
  try {
    unlinkSync(CUSTOM_MENU_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function writeFile(content: string) {
  mkdirSync(dirname(CUSTOM_MENU_FILE), { recursive: true });
  writeFileSync(CUSTOM_MENU_FILE, content);
}

function restoreFile() {
  if (original == null) return clearFile();
  writeFile(original);
}

beforeEach(() => {
  original = existsSync(CUSTOM_MENU_FILE) ? readFileSync(CUSTOM_MENU_FILE, 'utf-8') : null;
  writeFile(JSON.stringify({ items: [{ path: '/custom-one', label: 'Custom One' }] }));
});

afterEach(restoreFile);

describe('DELETE /api/menu/custom/*', () => {
  test('removes a file-backed custom menu item by path', async () => {
    const removed = await requestJson<Record<string, any>>(
      createMenuApp(),
      'DELETE',
      '/api/menu/custom/%2Fcustom-one',
    );

    expect(removed.status).toBe(200);
    expect(removed.json).toEqual({ removed: true, path: '/custom-one' });
  });
});
