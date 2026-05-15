ALTER TABLE `appointments` ADD `staffNotes` text;--> statement-breakpoint
ALTER TABLE `business_owners` ADD `timezone` varchar(64) DEFAULT 'America/New_York' NOT NULL;