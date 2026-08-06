ALTER TABLE `oracle_memories` ADD `superseded_at` integer;
--> statement-breakpoint
ALTER TABLE `oracle_memories` ADD `superseded_reason` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_tenant_superseded` ON `oracle_memories` (`tenant_id`,`superseded_at`);
