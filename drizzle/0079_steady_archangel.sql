ALTER TABLE `business_owners` ADD `pendingDeletionAt` timestamp;--> statement-breakpoint
ALTER TABLE `business_owners` ADD `deletionScheduledFor` timestamp;