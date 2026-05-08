CREATE TABLE `gift_certificate_recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`giftCardLocalId` varchar(64) NOT NULL,
	`giftCardCode` varchar(20) NOT NULL,
	`businessOwnerId` int NOT NULL,
	`clientAccountId` int,
	`recipientPhone` varchar(20),
	`recipientEmail` varchar(320),
	`linked` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gift_certificate_recipients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_packages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessOwnerId` int NOT NULL,
	`localId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`packageItems` json NOT NULL,
	`totalSessions` int NOT NULL DEFAULT 1,
	`sessionDurationMinutes` int NOT NULL DEFAULT 60,
	`originalPrice` decimal(10,2) NOT NULL,
	`packagePrice` decimal(10,2) NOT NULL,
	`photoUri` varchar(2048),
	`category` varchar(100),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_packages_id` PRIMARY KEY(`id`)
);
