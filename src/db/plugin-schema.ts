import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const pluginMetadata = sqliteTable('plugin_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').default('default').notNull(),
  surface: text('surface').notNull(),
  pluginId: text('plugin_id').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),
  renderer: text('renderer').notNull(),
  description: text('description'),
  standalonePath: text('standalone_path'),
  apiPath: text('api_path'),
  position: integer('position').default(0).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_plugin_metadata_tenant_surface_plugin')
    .on(table.tenantId, table.surface, table.pluginId),
  index('idx_plugin_metadata_tenant_surface').on(table.tenantId, table.surface),
]);
