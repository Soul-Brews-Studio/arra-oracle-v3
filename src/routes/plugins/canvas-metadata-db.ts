import { and, asc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { canvasRegistry } from '../../canvas/registry.ts';
import { listCanvasPluginMetadata, type CanvasPluginMetadataEntry } from '../../canvas/metadata.ts';
import * as schema from '../../db/schema.ts';
import { pluginMetadata } from '../../db/plugin-schema.ts';
import { activeTenantId } from '../../middleware/tenant.ts';

const CANVAS_SURFACE = 'canvas';

type Db = BunSQLiteDatabase<typeof schema>;
type PluginMetadataRow = typeof pluginMetadata.$inferSelect;

function canvasSeedRows(tenantId: string, now = Date.now()) {
  return listCanvasPluginMetadata().plugins.map((plugin, position) => ({
    tenantId,
    surface: CANVAS_SURFACE,
    pluginId: plugin.id,
    label: plugin.label,
    kind: plugin.kind,
    renderer: plugin.renderer,
    description: plugin.description ?? null,
    standalonePath: plugin.standalonePath ?? null,
    apiPath: plugin.apiPath ?? null,
    position,
    createdAt: now,
    updatedAt: now,
  }));
}

export function seedCanvasPluginMetadata(
  db: Db,
  tenantId = activeTenantId(),
): void {
  const rows = canvasSeedRows(tenantId);
  if (!rows.length) return;
  db.insert(pluginMetadata)
    .values(rows)
    .onConflictDoNothing({
      target: [pluginMetadata.tenantId, pluginMetadata.surface, pluginMetadata.pluginId],
    })
    .run();
}

function rowToMetadata(row: PluginMetadataRow): CanvasPluginMetadataEntry {
  return {
    id: row.pluginId,
    label: row.label,
    kind: row.kind as CanvasPluginMetadataEntry['kind'],
    renderer: row.renderer as CanvasPluginMetadataEntry['renderer'],
    description: row.description ?? undefined,
    standalonePath: row.standalonePath ?? undefined,
    apiPath: row.apiPath ?? undefined,
  };
}

export function registeredCanvasPluginMetadataRegistry(
  db: Db,
  tenantId = activeTenantId(),
) {
  seedCanvasPluginMetadata(db, tenantId);
  const rows = db.select()
    .from(pluginMetadata)
    .where(and(
      eq(pluginMetadata.tenantId, tenantId),
      eq(pluginMetadata.surface, CANVAS_SURFACE),
    ))
    .orderBy(asc(pluginMetadata.position), asc(pluginMetadata.pluginId))
    .all();
  const plugins = rows.map(rowToMetadata);
  return {
    kind: CANVAS_SURFACE,
    count: plugins.length,
    plugins,
    standalone: canvasRegistry().standalone,
  };
}

export async function defaultCanvasPluginMetadataRegistry(tenantId = activeTenantId()) {
  const { db } = await import('../../db/index.ts');
  return registeredCanvasPluginMetadataRegistry(db, tenantId);
}
