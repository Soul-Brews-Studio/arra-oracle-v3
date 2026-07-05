CREATE TABLE `plugin_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`surface` text NOT NULL,
	`plugin_id` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`renderer` text NOT NULL,
	`description` text,
	`standalone_path` text,
	`api_path` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_metadata_tenant_surface_plugin`
ON `plugin_metadata` (`tenant_id`,`surface`,`plugin_id`);
--> statement-breakpoint
CREATE INDEX `idx_plugin_metadata_tenant_surface`
ON `plugin_metadata` (`tenant_id`,`surface`);
