ALTER TABLE `oracle_memories` ADD `valid_from` integer;--> statement-breakpoint
ALTER TABLE `oracle_memories` ADD `valid_to` integer;--> statement-breakpoint
CREATE INDEX `idx_memory_tenant_valid_time`
ON `oracle_memories` (`tenant_id`,`valid_from`,`valid_to`);
