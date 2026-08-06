ALTER TABLE `oracle_memories` ADD `superseded_by` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_superseded_by` ON `oracle_memories` (`superseded_by`);
