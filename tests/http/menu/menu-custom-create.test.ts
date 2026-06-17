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

function restoreFile() {
  if (original == null) return clearFile();
  mkdirSync(dirname(CUSTOM_MENU_FILE), { recursive: true });
  writeFileSync(CUSTOM_MENU_FILE, original);
}

beforeEach(() => {
  original = existsSync(CUSTOM_MENU_FILE) ? readFileSync(CUSTOM_MENU_FILE, 'utf-8') : null;
  clearFile();
});

afterEach(restoreFile);

describe('POST /api/menu/custom', () => {
  test('adds a file-backed custom menu item', async () => {
    const created = await requestJson<Record<string, any>>(createMenuApp(), 'POST', '/api/menu/custom', {
      path: 'custom-one',
      label: 'Custom One',
      group: 'tools',
    });

    expect(created.status).toBe(201);
    expect(created.json.item).toMatchObject({ path: '/custom-one', added: true });
  });

  test('rejects blank path after trimming', async () => {
    const created = await requestJson<Record<string, any>>(createMenuApp(), 'POST', '/api/menu/custom', {
      path: '   ',
      label: 'Blank',
      group: 'tools',
    });

    expect(created.status).toBe(400);
    expect(created.json.error).toContain('path and label');
  });
});
