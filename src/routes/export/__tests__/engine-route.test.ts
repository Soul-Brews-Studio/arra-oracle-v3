/**
 * Route-shadowing defect (2026-08-17): the export-history job recorder claims
 * '/export/run' first, so the full export engine's identical route was
 * unreachable over HTTP (308 -> v1 -> history validation). The engine now owns
 * '/export/engine/run'; both surfaces must stay independently reachable.
 */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createExportRoutes } from '../index.ts';
import { exportCoreRoutes } from '../core.ts';

function routePaths(app: Elysia): string[] {
  return (app as unknown as { routes: Array<{ method: string; path: string }> }).routes
    .filter(r => r.method === 'POST')
    .map(r => r.path);
}

describe('export engine route is not shadowed', () => {
  test('history keeps /export/run; engine owns /export/engine/run', () => {
    const combined = new Elysia().use(createExportRoutes()).use(exportCoreRoutes);
    const posts = routePaths(combined);
    expect(posts).toContain('/api/export/run');
    expect(posts).toContain('/api/export/engine/run');
  });

  test('history validation still guards /export/run (collection required)', async () => {
    const combined = new Elysia().use(createExportRoutes()).use(exportCoreRoutes);
    const res = await combined.handle(new Request('http://local/api/export/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    expect([400, 422]).toContain(res.status);
    const body = await res.text();
    expect(body).toContain('collection');
  });
});
