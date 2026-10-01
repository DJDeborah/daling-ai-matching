CREATE TABLE `conversations` (
	`user_id` text PRIMARY KEY NOT NULL,
	`turn` integer NOT NULL,
	`step` integer NOT NULL,
	`status` text NOT NULL,
	`draft_json` text NOT NULL,
	`messages_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `match_reports` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_updated_at` text NOT NULL,
	`demo_version` integer NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL
);
