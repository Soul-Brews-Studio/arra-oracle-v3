CREATE TABLE `concept_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_concept_entity_name` ON `concept_entities` (`name`);--> statement-breakpoint
CREATE TABLE `concept_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_id` text NOT NULL,
	`predicate` text NOT NULL,
	`object_id` text NOT NULL,
	`source_doc_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `concept_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`object_id`) REFERENCES `concept_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_doc_id`) REFERENCES `oracle_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_concept_rel_subject` ON `concept_relations` (`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_concept_rel_object` ON `concept_relations` (`object_id`);--> statement-breakpoint
CREATE INDEX `idx_concept_rel_source` ON `concept_relations` (`source_doc_id`);--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD `status` text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD `valid_from` integer;--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD `valid_until` integer;--> statement-breakpoint
ALTER TABLE `oracle_documents` ADD `trace_id` text;--> statement-breakpoint
CREATE INDEX `idx_status` ON `oracle_documents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_doc_trace_id` ON `oracle_documents` (`trace_id`);
