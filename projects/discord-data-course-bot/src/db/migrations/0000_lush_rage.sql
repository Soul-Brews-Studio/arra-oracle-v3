CREATE TABLE `thread_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_thread_messages_thread` ON `thread_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`topic` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
