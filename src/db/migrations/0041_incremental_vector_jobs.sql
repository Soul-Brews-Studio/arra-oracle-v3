-- Durable vector job identity: a vector is identified by its model, chunk and
-- canonical payload hash, not merely the document id. Existing rows retain a
-- distinct legacy marker so this additive migration never collapses history.
ALTER TABLE `indexing_jobs` ADD COLUMN `content_hash` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `indexing_jobs` ADD COLUMN `operation` text NOT NULL DEFAULT 'upsert';
--> statement-breakpoint
ALTER TABLE `indexing_jobs` ADD COLUMN `lease_expires_at` integer;
--> statement-breakpoint
UPDATE `indexing_jobs`
SET `content_hash` = 'legacy:' || `id`
WHERE `content_hash` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_indexing_jobs_identity`
  ON `indexing_jobs` (`model_key`, `doc_id`, `content_hash`, `operation`);
