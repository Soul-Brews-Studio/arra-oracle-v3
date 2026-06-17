ALTER TABLE `oracle_documents` ADD `usage_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD `last_accessed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_documents_usage_heat` ON `oracle_documents` (`usage_count`,`last_accessed_at`);
