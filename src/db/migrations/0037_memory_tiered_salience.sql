ALTER TABLE `oracle_memories` ADD `tier` text DEFAULT 'warm' NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_memories` ADD `heat_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_memories` ADD `usage_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_memories` ADD `last_accessed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_memory_tenant_tier_heat` ON `oracle_memories` (`tenant_id`,`tier`,`heat_score`);
