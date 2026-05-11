ALTER TABLE `client_messages` ADD `deletedByBusiness` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `client_messages` ADD `deletedByClient` boolean DEFAULT false;