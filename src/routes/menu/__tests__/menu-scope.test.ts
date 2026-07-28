/**
 * #949: scope column — sub-nav scope separation.
 * Exercises scopeMatches() and readApiMenuItemsFromDb(?scope=) filtering.
 */

import { describe, it, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { scopeMatches, readApiMenuItemsFromDb } from '../menu.ts';
import { db, menuItems } from '../../../db/index.ts';

// ---------------------------------------------------------------------------
// scopeMatches unit tests (pure function, no DB)
// ---------------------------------------------------------------------------

describe('scopeMatches', () => {
  it('returns true when no filter is provided (backward compat)', () => {
    expect(scopeMatches('main', undefined)).toBe(true);
    expect(scopeMatches('sub', undefined)).toBe(true);
    expect(scopeMatches('both', undefined)).toBe(true);
  });

  it('scope=main matches rows with scope=main', () => {
    expect(scopeMatches('main', 'main')).toBe(true);
  });

  it('scope=main does NOT match rows with scope=sub', () => {
    expect(scopeMatches('sub', 'main')).toBe(false);
  });

  it('scope=sub matches rows with scope=sub', () => {
    expect(scopeMatches('sub', 'sub')).toBe(true);
  });

  it('scope=sub does NOT match rows with scope=main', () => {
    expect(scopeMatches('main', 'sub')).toBe(false);
  });

  it('scope=both matches any filter', () => {
    expect(scopeMatches('both', 'main')).toBe(true);
    expect(scopeMatches('both', 'sub')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB round-trip: scope filtering via readApiMenuItemsFromDb
// ---------------------------------------------------------------------------

describe('readApiMenuItemsFromDb — scope filter', () => {
  const now = new Date();
  const prefix = `/__scope_test_${Date.now()}`;
  const mainPath = `${prefix}/header`;
  const subPath = `${prefix}/subnav`;
  const bothPath = `${prefix}/shared`;

  function seed() {
    db.insert(menuItems)
      .values([
        {
          path: mainPath,
          label: 'Header Item',
          groupKey: 'main',
          position: 10,
          enabled: true,
          access: 'public',
          source: 'custom',
          scope: 'main',
          touchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          path: subPath,
          label: 'SubNav Item',
          groupKey: 'main',
          position: 11,
          enabled: true,
          access: 'public',
          source: 'custom',
          scope: 'sub',
          touchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          path: bothPath,
          label: 'Shared Item',
          groupKey: 'main',
          position: 12,
          enabled: true,
          access: 'public',
          source: 'custom',
          scope: 'both',
          touchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  }

  function cleanup() {
    db.delete(menuItems).where(eq(menuItems.path, mainPath)).run();
    db.delete(menuItems).where(eq(menuItems.path, subPath)).run();
    db.delete(menuItems).where(eq(menuItems.path, bothPath)).run();
  }

  it('no scope filter returns all three items', () => {
    seed();
    try {
      const items = readApiMenuItemsFromDb();
      const paths = items.filter((i) => i.path.startsWith(prefix)).map((i) => i.path);
      expect(paths).toContain(mainPath);
      expect(paths).toContain(subPath);
      expect(paths).toContain(bothPath);
    } finally {
      cleanup();
    }
  });

  it('scope=main returns main + both, excludes sub', () => {
    seed();
    try {
      const items = readApiMenuItemsFromDb(undefined, 'main');
      const paths = items.filter((i) => i.path.startsWith(prefix)).map((i) => i.path);
      expect(paths).toContain(mainPath);
      expect(paths).toContain(bothPath);
      expect(paths).not.toContain(subPath);
    } finally {
      cleanup();
    }
  });

  it('scope=sub returns sub + both, excludes main', () => {
    seed();
    try {
      const items = readApiMenuItemsFromDb(undefined, 'sub');
      const paths = items.filter((i) => i.path.startsWith(prefix)).map((i) => i.path);
      expect(paths).toContain(subPath);
      expect(paths).toContain(bothPath);
      expect(paths).not.toContain(mainPath);
    } finally {
      cleanup();
    }
  });

  it('scope=sub items expose scope field in response', () => {
    seed();
    try {
      const items = readApiMenuItemsFromDb(undefined, 'sub');
      const subItem = items.find((i) => i.path === subPath);
      expect(subItem).toBeDefined();
      expect(subItem!.scope).toBe('sub');
    } finally {
      cleanup();
    }
  });
});
