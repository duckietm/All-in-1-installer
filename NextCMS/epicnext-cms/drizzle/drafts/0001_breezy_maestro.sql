CREATE TABLE `website_daily_reward_claims` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`claim_date` date NOT NULL,
	`streak` int unsigned NOT NULL DEFAULT 1,
	`reward_day` int unsigned NOT NULL DEFAULT 1,
	`currency` varchar(20) NOT NULL DEFAULT 'credits',
	`amount` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `website_daily_reward_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_claim_user_date_uk` UNIQUE(`user_id`,`claim_date`)
);
--> statement-breakpoint
CREATE TABLE `website_daily_rewards` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`day` int unsigned NOT NULL DEFAULT 1,
	`currency` varchar(20) NOT NULL DEFAULT 'credits',
	`amount` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `website_daily_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_audit_log` MODIFY COLUMN `before` mediumtext;--> statement-breakpoint
ALTER TABLE `admin_audit_log` MODIFY COLUMN `after` mediumtext;