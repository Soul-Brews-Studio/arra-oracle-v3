CREATE TABLE `tenants` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tenants_status` ON `tenants` (`status`);
--> statement-breakpoint
INSERT INTO `tenants` (`id`, `name`, `status`, `created_at`, `updated_at`)
VALUES ('default', 'Default tenant', 'active', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_documents_tenant` ON `oracle_documents` (`tenant_id`);
--> statement-breakpoint
ALTER TABLE `search_log` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_search_tenant` ON `search_log` (`tenant_id`);
--> statement-breakpoint
ALTER TABLE `learn_log` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_learn_tenant` ON `learn_log` (`tenant_id`);
--> statement-breakpoint
ALTER TABLE `document_access` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_access_tenant` ON `document_access` (`tenant_id`);
--> statement-breakpoint
ALTER TABLE `forum_threads` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_thread_tenant` ON `forum_threads` (`tenant_id`);
--> statement-breakpoint
ALTER TABLE `trace_log` ADD COLUMN `tenant_id` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_trace_tenant` ON `trace_log` (`tenant_id`);
