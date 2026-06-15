import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { db, menuItems } from '../../../src/db/index.ts';
import type { UnifiedMenuManifest } from '../../../src/plugins/unified-manifest.ts';

export function writeUnifiedPlugin(
  root: string,
  name: string,
  menu: UnifiedMenuManifest[],
): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.ts'),
    `export function greet() { return { ok: true, body: { source: 'handler' } }; }\n`,
  );
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      entry: './index.ts',
      apiRoutes: [{ path: `/api/${name}/hello`, methods: ['GET'], handler: 'greet' }],
      menu,
    }, null, 2),
  );
}

export function deleteMenuPath(path: string): void {
  db.delete(menuItems).where(eq(menuItems.path, path)).run();
}

export function insertLegacyMenuRow(input: {
  path: string;
  label: string;
  groupKey?: string;
  position?: number;
  source?: string;
  studio?: string | null;
}) {
  const now = new Date();
  return db
    .insert(menuItems)
    .values({
      path: input.path,
      label: input.label,
      groupKey: input.groupKey ?? 'tools',
      position: input.position ?? 10,
      enabled: true,
      access: 'public',
      source: input.source ?? 'route',
      studio: input.studio ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export async function fetchMenuItems(app: { handle(request: Request): Response | Promise<Response> }) {
  const res = await app.handle(new Request('http://localhost/api/menu'));
  return {
    status: res.status,
    items: ((await res.json()) as { items: Array<Record<string, unknown>> }).items,
  };
}
