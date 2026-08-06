CREATE INDEX `idx_documents_tenant_type_active_updated` ON `oracle_documents` (`tenant_id`,`type`,`superseded_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_search_tenant_created` ON `search_log` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_thread_tenant_status_updated` ON `forum_threads` (`tenant_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_menu_path_studio` ON `menu_items` (`path`,`studio`);
