/**
 * Issue #65: menu-seeder must key existing-row lookup on (path, studio)
 * composite, not path alone. Once subdomain extracts (Forum done, Feed/
 * Canvas/Schedule planned) all share path='/', a path-only lookup collides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, menuItems } from '../../../db/index.ts';
import { seedMenuItems } from '../../../db/seeders/menu-seeder.ts';

const FORUM_STUDIO = 'forum.buildwithoracle.com';
const FEED_STUDIO = 'feed.buildwithoracle.com';

function cleanupRows(): void {
  db
    .delete(menuItems)
    .where(
      or(
        eq(menuItems.label, '__composite_forum__'),
        eq(menuItems.label, '__composite_feed__'),
        eq(menuItems.label, '__composite_route__'),
      ),
    )
    .run();
  db
    .delete(menuItems)
    .where(and(eq(menuItems.path, '/'), isNull(menuItems.studio)))
    .run();
}

function routeSource() {
  return new Elysia({ prefix: '/api' }).get('/threads', () => ({}), {
    detail: {
      menu: { group: 'main', path: '/', order: 40, label: '__composite_route__' },
      summary: 'Threads',
    },
  });
}

describe('menu-seeder — composite (path, studio) lookup (#65)', () => {
  beforeEach(() => {
    cleanupRows();
  });

  afterEach(() => {
    cleanupRows();
  });

  it('two rows sharing path=/ with different studio do not collide', () => {
    const now = new Date();
    db.insert(menuItems)
      .values({
        path: '/',
        studio: FORUM_STUDIO,
        label: '__composite_forum__',
        groupKey: 'main',
        position: 42,
        enabled: true,
        access: 'public',
        source: 'route',
        touchedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(menuItems)
      .values({
        path: '/',
        studio: FEED_STUDIO,
        label: '__composite_feed__',
        groupKey: 'main',
        position: 30,
        enabled: true,
        access: 'public',
        source: 'route',
        touchedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const rows = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/'))
      .all();
    const studios = rows.map((r) => r.studio).sort();
    expect(studios).toEqual([FEED_STUDIO, FORUM_STUDIO]);
  });

  it('seeder updates only the (path, studio) match — leaves sibling rows untouched', () => {
    const now = new Date();
    // Simulate post-0013 forum row (path=/, studio=forum.*) + hypothetical
    // future feed extract row (path=/, studio=feed.*). Both are source=route,
    // untouched — the current reseed would previously clobber whichever
    // matched `eq(path, '/')` first.
    db.insert(menuItems)
      .values({
        path: '/',
        studio: FORUM_STUDIO,
        label: '__composite_forum__',
        groupKey: 'main',
        position: 42,
        enabled: true,
        access: 'public',
        source: 'route',
        touchedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(menuItems)
      .values({
        path: '/',
        studio: FEED_STUDIO,
        label: '__composite_feed__',
        groupKey: 'main',
        position: 30,
        enabled: true,
        access: 'public',
        source: 'route',
        touchedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    seedMenuItems([routeSource()]);

    const forum = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.path, '/'), eq(menuItems.studio, FORUM_STUDIO)))
      .get();
    const feed = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.path, '/'), eq(menuItems.studio, FEED_STUDIO)))
      .get();

    // Studio-bearing rows untouched — seeder only matches isNull(studio) routes.
    expect(forum?.label).toBe('__composite_forum__');
    expect(forum?.position).toBe(42);
    expect(feed?.label).toBe('__composite_feed__');
    expect(feed?.position).toBe(30);

    // The route (/api/threads → studio path '/') produces studio=null and
    // does NOT collide with the subdomain rows — it inserts a fresh row.
    const routeRow = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.path, '/'), isNull(menuItems.studio)))
      .get();
    expect(routeRow?.label).toBe('__composite_route__');
  });

  it('reseed is idempotent for null-studio route rows at path=/', () => {
    seedMenuItems([routeSource()]);
    const first = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.path, '/'), isNull(menuItems.studio)))
      .get();
    expect(first?.label).toBe('__composite_route__');

    const second = seedMenuItems([routeSource()]);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);

    // Still exactly one null-studio row at path=/.
    const rows = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.path, '/'), isNull(menuItems.studio)))
      .all();
    expect(rows).toHaveLength(1);
  });
});
