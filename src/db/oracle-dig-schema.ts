import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const oracleFindings = sqliteTable('oracle_findings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').default('default').notNull(),
  subject: text('subject').notNull(),
  relation: text('relation'),
  object: text('object'),
  dugBy: text('dug_by').notNull(),
  asOfTs: integer('as_of_ts').notNull(),
  asOfCommit: text('as_of_commit'),
  confidence: real('confidence').notNull(),
  topic: text('topic'),
  frictionScore: real('friction_score'),
  commissionedBy: text('commissioned_by'),
  iterations: integer('iterations').default(1).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_findings_tenant').on(table.tenantId),
  index('idx_findings_subject').on(table.subject),
  index('idx_findings_topic').on(table.topic),
  index('idx_findings_dug_by').on(table.dugBy),
]);

export const oracleFindingEvidence = sqliteTable('oracle_finding_evidence', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  findingId: text('finding_id').notNull().references(() => oracleFindings.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').default('default').notNull(),
  kind: text('kind', { enum: ['github', 'session', 'oracle-msg', 'web'] }).notNull(),
  githubOwner: text('github_owner'),
  githubRepo: text('github_repo'),
  githubPath: text('github_path'),
  githubRef: text('github_ref'),
  githubLine: integer('github_line'),
  sessionId: text('session_id'),
  sessionOracle: text('session_oracle'),
  oracleMsgFrom: text('oracle_msg_from'),
  oracleMsgAt: integer('oracle_msg_at'),
  webUrl: text('web_url'),
  webFetchedAt: integer('web_fetched_at'),
  commit: text('commit'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_evidence_finding').on(table.findingId),
  index('idx_evidence_kind').on(table.kind),
  index('idx_evidence_github').on(table.githubOwner, table.githubRepo, table.githubPath),
  index('idx_evidence_session').on(table.sessionId),
]);
