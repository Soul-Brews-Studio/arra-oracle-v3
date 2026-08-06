ALTER TABLE `export_jobs` ADD `tenant_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_export_jobs_tenant_timestamp` ON `export_jobs` (`tenant_id`,`timestamp`);