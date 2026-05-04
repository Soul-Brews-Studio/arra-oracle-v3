CREATE TABLE `indexing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`model_key` text NOT NULL,
	`collection` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')*1000) NOT NULL,
	`claimed_at` integer,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_indexing_jobs_pending` ON `indexing_jobs` (`status`,`model_key`,`created_at`) WHERE `status` IN ('pending','claimed');
--> statement-breakpoint
CREATE INDEX `idx_indexing_jobs_doc` ON `indexing_jobs` (`doc_id`);
