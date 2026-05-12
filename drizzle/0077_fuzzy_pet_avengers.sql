CREATE TABLE `referral_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessOwnerId` int NOT NULL,
	`code` varchar(32) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`totalUses` int NOT NULL DEFAULT 0,
	`discountPercent` int NOT NULL DEFAULT 50,
	`discountMonths` int NOT NULL DEFAULT 3,
	`stripeCouponId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referral_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referralCodeId` int NOT NULL,
	`referrerBusinessOwnerId` int NOT NULL,
	`referredBusinessOwnerId` int NOT NULL,
	`status` enum('pending','converted','rewarded','expired') NOT NULL DEFAULT 'pending',
	`appliedCouponId` varchar(255),
	`convertedAt` timestamp,
	`rewardedAt` timestamp,
	`referrerRewardId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
