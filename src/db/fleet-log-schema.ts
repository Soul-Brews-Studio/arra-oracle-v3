import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const fleetMessages = sqliteTable('fleet_messages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').default('default').notNull(),
  channel: text('channel').notNull(),          // 'maw' | 'vault' | 'webhook' | 'discord' | 'agent-team' | 'git'
  source: text('source'),
  direction: text('direction'),                // 'outbound' | 'inbound' | 'forwarded' | null
  fromId: text('from_id'),
  toId: text('to_id'),
  threadKey: text('thread_key'),                // heuristic grouping, NOT a hard FK — see below
  text: text('text'),
  raw: text('raw'),
  rawPath: text('raw_path'),
  ts: integer('ts').notNull(),
  ingestedAt: integer('ingested_at').notNull(),
}, (table) => [
  index('idx_fleet_msg_channel_ts').on(table.channel, table.ts),
  index('idx_fleet_msg_from').on(table.fromId),
  index('idx_fleet_msg_to').on(table.toId),
  index('idx_fleet_msg_thread').on(table.threadKey),
  index('idx_fleet_msg_tenant_ts').on(table.tenantId, table.ts),
]);

export const fleetIngestCursor = sqliteTable('fleet_ingest_cursor', {
  id: text('id').primaryKey(),                  // 'maw-ledger' | 'vault:<repo-name>' | ...
  lastCursor: text('last_cursor'),
  lastRunAt: integer('last_run_at'),
  status: text('status').default('idle').notNull(),
  error: text('error'),
});
