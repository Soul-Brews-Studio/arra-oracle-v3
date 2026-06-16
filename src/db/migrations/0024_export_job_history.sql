CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`format` text NOT NULL,
	`timestamp` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_export_jobs_timestamp` ON `export_jobs` (`timestamp`);
