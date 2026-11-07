CREATE TABLE `mcp_explanations` (
	`user_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`locale` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `tool_call_id`, `locale`)
);
