CREATE TABLE `blocks` (
	`from_profile_id` text NOT NULL,
	`to_profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`from_profile_id`, `to_profile_id`)
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`from_profile_id` text NOT NULL,
	`to_profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`from_profile_id`, `to_profile_id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`seeking` text NOT NULL,
	`age` integer NOT NULL,
	`min_age` integer NOT NULL,
	`max_age` integer NOT NULL,
	`city` text NOT NULL,
	`preferred_city` text NOT NULL,
	`height_cm` integer,
	`preferred_height_min` integer,
	`preferred_height_max` integer,
	`body_type` text NOT NULL,
	`preferred_body_type` text NOT NULL,
	`school` text NOT NULL,
	`mbti` text NOT NULL,
	`zodiac` text NOT NULL,
	`preferred_zodiac` text NOT NULL,
	`interests_json` text NOT NULL,
	`about` text NOT NULL,
	`partner_note` text NOT NULL,
	`contact_kind` text NOT NULL,
	`contact_value` text NOT NULL,
	`contact_share` integer NOT NULL,
	`visible` integer NOT NULL,
	`adult_confirmed_at` text NOT NULL,
	`pool_consented_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_unique` ON `profiles` (`user_id`);