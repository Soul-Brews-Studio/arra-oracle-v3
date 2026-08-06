ALTER TABLE `oracle_memories` ADD `tenant_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_memory_tenant_created` ON `oracle_memories` (`tenant_id`,`created_at`);
