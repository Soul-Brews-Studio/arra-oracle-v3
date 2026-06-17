ALTER TABLE `oracle_documents` ADD `valid_time` integer;
--> statement-breakpoint
UPDATE `oracle_documents`
SET `valid_time` = COALESCE(`updated_at`, `created_at`, `indexed_at`)
WHERE `valid_time` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_documents_tenant_valid_time`
ON `oracle_documents` (`tenant_id`,`valid_time`);
