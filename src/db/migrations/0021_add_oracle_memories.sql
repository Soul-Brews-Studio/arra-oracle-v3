CREATE TABLE `oracle_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`title` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memory_created` ON `oracle_memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_title` ON `oracle_memories` (`title`);--> statement-breakpoint
CREATE INDEX `idx_memory_source` ON `oracle_memories` (`source`);