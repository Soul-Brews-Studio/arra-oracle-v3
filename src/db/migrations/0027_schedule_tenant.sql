ALTER TABLE `schedule` ADD `tenant_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schedule_tenant_date` ON `schedule` (`tenant_id`,`date`);
