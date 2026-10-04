CREATE TABLE `wechat_binding_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_binding_codes_code_hash_unique` ON `wechat_binding_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `wechat_bindings` (
	`identity_hash` text PRIMARY KEY NOT NULL,
	`binding_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_bindings_binding_id_unique` ON `wechat_bindings` (`binding_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_bindings_user_id_unique` ON `wechat_bindings` (`user_id`);--> statement-breakpoint
CREATE TABLE `wechat_events` (
	`event_hash` text PRIMARY KEY NOT NULL,
	`identity_hash` text NOT NULL,
	`user_id` text,
	`binding_id` text,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`reply` text,
	`started_revision` text,
	`started_turn` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wechat_events_created_idx` ON `wechat_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `wechat_events_user_idx` ON `wechat_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `wechat_locks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
