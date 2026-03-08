ALTER TABLE `schedule` ADD `tempo` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_schedule_tempo` ON `schedule` (`tempo`);
