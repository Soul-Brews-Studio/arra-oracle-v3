import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCustomMenuItem, listCustomMenuItems, removeCustomMenuItem } from '../custom-store.ts';

let tmp = '';

function tempFile() {
  tmp = mkdtempSync(join(tmpdir(), 'arra-menu-custom-'));
  return join(tmp, 'custom-menu.json');
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

describe('custom menu store edge handling', () => {
  test('lists only well-formed custom items and normalizes runtime fields', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({
      items: [
        { path: ' alpha ', label: ' Alpha ', group: 'bogus', order: 'late', icon: ' star ' },
        { path: '/admin', label: 'Admin', group: 'admin', order: 12 },
        { path: '   ', label: 'Blank path' },
        { path: '/blank-label', label: '   ' },
        null,
      ],
    }));

    expect(listCustomMenuItems(file)).toEqual([
      { path: '/alpha', label: 'Alpha', group: 'tools', order: 90, icon: 'star', source: 'page' },
      { path: '/admin', label: 'Admin', group: 'admin', order: 12, source: 'page' },
    ]);
  });

  test('rejects blank add input and replaces by normalized path', () => {
    const file = tempFile();

    expect(() => addCustomMenuItem({ path: '  ', label: 'Nope' }, file)).toThrow('path and label');
    expect(addCustomMenuItem({ path: 'tools', label: 'Tools' }, file)).toMatchObject({
      added: true,
      replaced: false,
      item: { path: '/tools', label: 'Tools', group: 'tools', order: 90 },
    });
    expect(addCustomMenuItem({ path: '/tools', label: 'Tools v2', group: 'main' }, file)).toMatchObject({
      added: false,
      replaced: true,
      item: { path: '/tools', label: 'Tools v2', group: 'main' },
    });
    expect(removeCustomMenuItem('tools', file)).toEqual({ removed: true, path: '/tools' });
  });
});
