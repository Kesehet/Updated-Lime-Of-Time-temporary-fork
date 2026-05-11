ALTER TABLE `appointments` ADD `packageBookingId` varchar(64);--> statement-breakpoint
ALTER TABLE `appointments` ADD `packageLocalId` varchar(64);--> statement-breakpoint
ALTER TABLE `appointments` ADD `sessionNumber` int;--> statement-breakpoint
ALTER TABLE `appointments` ADD `sessionTotal` int;--> statement-breakpoint
ALTER TABLE `appointments` ADD `packageName` varchar(255);--> statement-breakpoint
ALTER TABLE `gift_cards` ADD `packageLocalId` varchar(64);--> statement-breakpoint
ALTER TABLE `service_packages` ADD `bufferDays` int DEFAULT 0;