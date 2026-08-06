import { and, eq, isNull } from 'drizzle-orm';

import { db, menuItems } from '../db/index.ts';
import type { UnifiedMenuManifest } from './unified-manifest.ts';

export type UnifiedPluginMenuSeedItem = UnifiedMenuManifest & { plugin: string };

function nullStudioPluginPath(path: string) {
  return and(eq(menuItems.path, path), isNull(menuItems.studio));
}

export async function seedUnifiedPluginMenuItems(
  items: UnifiedPluginMenuSeedItem[],
): Promise<void> {
  if (!items.length) return;

  const now = new Date();
  for (const item of items) {
    const existing = db
      .select()
      .from(menuItems)
      .where(nullStudioPluginPath(item.path))
      .get();
    if (existing && existing.source !== 'plugin') continue;

    const values = {
      path: item.path,
      label: item.label,
      groupKey: item.group ?? 'tools',
      position: item.order ?? 999,
      source: 'plugin',
      icon: item.icon ?? null,
      updatedAt: now,
    };

    if (existing) {
      db.update(menuItems).set(values).where(eq(menuItems.id, existing.id)).run();
    } else {
      db.insert(menuItems)
        .values({ ...values, access: 'public', enabled: true, createdAt: now })
        .run();
    }
  }
}
