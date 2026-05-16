ALTER TABLE `services` ADD `distanceFeeEnabled` tinyint DEFAULT 0;--> statement-breakpoint
ALTER TABLE `services` ADD `freeMiles` decimal(6,1);--> statement-breakpoint
ALTER TABLE `services` ADD `blockOutOfRange` tinyint DEFAULT 0;--> statement-breakpoint
ALTER TABLE `staff_members` ADD `maxTravelDistance` decimal(8,2);