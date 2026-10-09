CREATE TABLE `discord_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `discord_link_codes_user_idx` ON `discord_link_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `discord_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`discord_username` text NOT NULL,
	`bot_id` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_links_discord_user_uidx` ON `discord_links` (`discord_user_id`);