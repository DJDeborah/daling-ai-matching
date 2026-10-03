CREATE TABLE `draft_match_reports` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_updated_at` text NOT NULL,
	`demo_version` integer NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
