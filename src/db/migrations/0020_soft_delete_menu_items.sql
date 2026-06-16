ALTER TABLE `menu_items` ADD `deleted_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_menu_deleted_at` ON `menu_items` (`deleted_at`);
