import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMenuItemsFromDir } from '../index.ts';

let tmp = '';

function tempDir() {
  tmp = mkdtempSync(join(tmpdir(), 'arra-menu-dir-'));
  return tmp;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

describe('menu directory loader edge handling', () => {
  test('falls back to bundled defaults when directory is missing', async () => {
    const items = await loadMenuItemsFromDir(join(tmpdir(), `missing-${Date.now()}`));
    expect(items.map((item) => item.path)).toContain('/feed');
  });

  test('skips malformed entries and normalizes duplicate menu paths', async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '01.json'), JSON.stringify([
      {
        path: ' alpha ', label: ' Alpha ', group: 'bogus', order: 'late', source: 'weird',
        access: 'auth', parentId: ' root ', studio: ' menu.example.test ', sourceName: ' env ',
        scope: 'sub', query: { ' keep ': ' yes ', blank: '   ', '': 'no', drop: 1 },
      },
      { path: '/dup', label: 'First', group: 'tools', order: 5, source: 'page' },
      { path: '', label: 'No path', group: 'tools', order: 1 },
      { path: '/no-label', label: '   ', group: 'tools', order: 1 },
    ]));
    writeFileSync(join(dir, '02.json'), JSON.stringify([
      { path: '/dup', label: 'Second', group: 'main', order: 2, source: 'api', icon: ' bolt ' },
    ]));
    writeFileSync(join(dir, 'broken.json'), '{not-json');

    expect(await loadMenuItemsFromDir(dir)).toEqual([
      {
        path: '/alpha', label: 'Alpha', group: 'tools', order: 999, source: 'page',
        access: 'auth', parentId: 'root', studio: 'menu.example.test', sourceName: 'env',
        scope: 'sub', query: { keep: 'yes' },
      },
      { path: '/dup', label: 'Second', group: 'main', order: 2, source: 'api', icon: 'bolt' },
    ]);
  });
});
