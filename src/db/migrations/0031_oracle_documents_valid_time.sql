ALTER TABLE `oracle_documents` ADD `valid_time` integer;
--> statement-breakpoint
CREATE INDEX `idx_documents_tenant_valid_time`
ON `oracle_documents` (`tenant_id`,`valid_time`);
