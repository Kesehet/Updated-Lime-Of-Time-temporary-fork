ALTER TABLE `appointments` ADD `clientAddress` text;--> statement-breakpoint
ALTER TABLE `services` ADD `serviceType` varchar(20) DEFAULT 'in_store';