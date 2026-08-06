ALTER TABLE `menu_items` ADD `tenant_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_menu_tenant` ON `menu_items` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_menu_tenant_deleted_position` ON `menu_items` (`tenant_id`,`deleted_at`,`position`);
