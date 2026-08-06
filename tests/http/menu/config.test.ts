/**
 * /api/menu configuration — item assembly and gist URL parsing.
 *
 * Split from a single 322-line file (#2833) so each file covers one area, per CLAUDE.md's
 * "nested, one behavior per file". The gist FETCH behaviour — retries, caching, hash pinning
 * and the source/reload endpoints — lives in `config-gist-fetch.test.ts`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  buildMenuItems,
  menuItemsFromRoutes,
  type MenuItem,
} from '../../../src/routes/menu/index.ts';
import {
  toRawGistUrl,
  parseGistUrl,
  buildRawGistUrl,
} from '../../../src/menu/gist.ts';


describe('buildMenuItems with extras', () => {
  test('disable set filters out items', () => {
    const sub = new Elysia({ prefix: '/api' }).get('/search', () => ({}), {
      detail: { menu: { group: 'main', order: 10 }, summary: 'Search' },
    });
    const items = buildMenuItems(menuItemsFromRoutes([sub]), { disable: ['/search'] });
    expect(items.find((i) => i.path === '/search')).toBeUndefined();
  });

  test('extras.items appended (gist merge)', () => {
    const extra: MenuItem = {
      path: '/lab',
      label: 'Lab',
      group: 'tools',
      order: 90,
      source: 'page',
    };
    const items = buildMenuItems([], { items: [extra] });
    expect(items.find((i) => i.path === '/lab')).toMatchObject({
      label: 'Lab',
      group: 'tools',
      order: 90,
    });
  });

  test('disable applies to gist-added items too', () => {
    const extra: MenuItem = {
      path: '/lab',
      label: 'Lab',
      group: 'tools',
      order: 90,
      source: 'page',
    };
    const items = buildMenuItems([], { items: [extra], disable: ['/lab'] });
    expect(items.find((i) => i.path === '/lab')).toBeUndefined();
  });

  test('disable also filters frontend-declared items', () => {
    const items = buildMenuItems([], { disable: ['/canvas'] });
    expect(items.find((i) => i.path === '/canvas')).toBeUndefined();
  });

  test('deduplicates gist item against existing frontend entry', () => {
    const dupe: MenuItem = {
      path: '/canvas',
      label: 'Canvas Override',
      group: 'tools',
      order: 1,
      source: 'page',
    };
    const items = buildMenuItems([], { items: [dupe] });
    const canvases = items.filter((i) => i.path === '/canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0].label).toBe('Canvas');
  });
});

describe('parseGistUrl / toRawGistUrl', () => {
  test('transforms gist page URL to raw URL', () => {
    expect(toRawGistUrl('https://gist.github.com/natw/abc123def456')).toBe(
      'https://gist.githubusercontent.com/natw/abc123def456/raw/',
    );
  });

  test('raw URL is passed through unchanged', () => {
    const raw = 'https://gist.githubusercontent.com/natw/abc123def456/raw/';
    expect(toRawGistUrl(raw)).toBe(raw);
  });

  test('parses hash-pinned gist URL', () => {
    const parsed = parseGistUrl(
      'https://gist.github.com/natw/abc123def456/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4',
    );
    expect(parsed).toEqual({
      user: 'natw',
      id: 'abc123def456',
      hash: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4',
    });
  });

  test('builds hash-pinned raw URL', () => {
    const raw = buildRawGistUrl({
      user: 'natw',
      id: 'abc123def456',
      hash: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4',
    });
    expect(raw).toBe(
      'https://gist.githubusercontent.com/natw/abc123def456/raw/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4/',
    );
  });
});

