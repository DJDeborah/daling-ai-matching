CREATE TABLE `like_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`from_profile_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `like_events_from_created_idx` ON `like_events` (`from_profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `blocks_to_idx` ON `blocks` (`to_profile_id`);--> statement-breakpoint
CREATE INDEX `likes_to_idx` ON `likes` (`to_profile_id`);--> statement-breakpoint
CREATE INDEX `profiles_visible_updated_idx` ON `profiles` (`visible`,`updated_at`);