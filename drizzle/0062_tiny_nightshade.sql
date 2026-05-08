ALTER TABLE `gift_cards` MODIFY COLUMN `serviceLocalId` varchar(64);--> statement-breakpoint
ALTER TABLE `service_packages` ADD `expiryDays` int;