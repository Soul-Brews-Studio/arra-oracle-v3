CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`who` text NOT NULL,
	`what` text NOT NULL,
	`when` integer NOT NULL,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_when` ON `audit_log` (`when`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_request` ON `audit_log` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_who` ON `audit_log` (`who`);
