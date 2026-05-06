CREATE TABLE `client_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`birthday` varchar(5),
	`profilePhotoUri` varchar(2048),
	`expoPushToken` varchar(255),
	`preferredRadius` int NOT NULL DEFAULT 25,
	`themeMode` enum('light','dark','system') NOT NULL DEFAULT 'system',
	`notificationPreferences` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_accounts_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `client_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessOwnerId` int NOT NULL,
	`clientAccountId` int NOT NULL,
	`senderType` enum('business','client') NOT NULL,
	`body` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `client_saved_businesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientAccountId` int NOT NULL,
	`businessOwnerId` int NOT NULL,
	`savedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_saved_businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessOwnerId` int NOT NULL,
	`serviceLocalId` varchar(64) NOT NULL,
	`uri` varchar(2048) NOT NULL,
	`label` enum('before','after','other') NOT NULL DEFAULT 'other',
	`note` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `business_owners` ADD `businessCategory` varchar(100);--> statement-breakpoint
ALTER TABLE `business_owners` ADD `lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `business_owners` ADD `lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `business_owners` ADD `clientPortalVisible` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `business_owners` ADD `appStoreUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `business_owners` ADD `playStoreUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `locations` ADD `lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `locations` ADD `lng` decimal(10,7);