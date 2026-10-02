ALTER TABLE `conversations` ADD `protocol_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `question_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `matching_json` text DEFAULT '{"version":2,"depth":{"version":1,"topics":{}}}' NOT NULL;