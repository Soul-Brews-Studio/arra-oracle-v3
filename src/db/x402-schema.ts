import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Request log for x402 HTTP-402 paid routes (see src/routes/x402/).
// One row per gated request: unpaid/rejected attempts and settled payments alike.
export const x402RequestLog = sqliteTable('x402_request_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  route: text('route').notNull(),
  status: text('status').notNull(), // unpaid | rejected | handler_failed | settlement_failed | settled
  network: text('network'),
  asset: text('asset'),
  amount: text('amount'), // atomic units (e.g. USDC has 6 decimals)
  payer: text('payer'),
  transaction: text('transaction'), // on-chain settlement tx hash, once settled
  errorReason: text('error_reason'),
  createdAt: integer('created_at').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  project: text('project'),
}, (table) => [
  index('idx_x402_log_route').on(table.route),
  index('idx_x402_log_status').on(table.status),
  index('idx_x402_log_created').on(table.createdAt),
]);
