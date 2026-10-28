-- 0009_radio_contests_giveaways_columns.sql
-- Fills in the empty RadioContests and RadioGiveaways tables with meaningful
-- columns. These tables were created in migration 0004 with only id/timestamps.

ALTER TABLE `radio_contests`
  ADD COLUMN IF NOT EXISTS `title` VARCHAR(255) NOT NULL AFTER `id`,
  ADD COLUMN IF NOT EXISTS `description` TEXT NULL AFTER `title`,
  ADD COLUMN IF NOT EXISTS `prize` VARCHAR(255) NULL AFTER `description`,
  ADD COLUMN IF NOT EXISTS `start_date` TIMESTAMP(0) NULL AFTER `prize`,
  ADD COLUMN IF NOT EXISTS `end_date` TIMESTAMP(0) NULL AFTER `start_date`,
  ADD COLUMN IF NOT EXISTS `winner_id` BIGINT UNSIGNED NULL AFTER `end_date`,
  ADD COLUMN IF NOT EXISTS `is_active` BOOLEAN NOT NULL DEFAULT true AFTER `winner_id`,
  ADD COLUMN IF NOT EXISTS `created_by` BIGINT UNSIGNED NULL AFTER `is_active`,
  MODIFY COLUMN `created_at` TIMESTAMP(0) NULL AFTER `created_by`,
  MODIFY COLUMN `updated_at` TIMESTAMP(0) NULL AFTER `created_at`;

ALTER TABLE `radio_giveaways`
  ADD COLUMN IF NOT EXISTS `title` VARCHAR(255) NOT NULL AFTER `id`,
  ADD COLUMN IF NOT EXISTS `description` TEXT NULL AFTER `title`,
  ADD COLUMN IF NOT EXISTS `prize` VARCHAR(255) NULL AFTER `description`,
  ADD COLUMN IF NOT EXISTS `prize_amount` INT NOT NULL DEFAULT 0 AFTER `prize`,
  ADD COLUMN IF NOT EXISTS `prize_currency` VARCHAR(50) NULL AFTER `prize_amount`,
  ADD COLUMN IF NOT EXISTS `start_date` TIMESTAMP(0) NULL AFTER `prize_currency`,
  ADD COLUMN IF NOT EXISTS `end_date` TIMESTAMP(0) NULL AFTER `start_date`,
  ADD COLUMN IF NOT EXISTS `winner_id` BIGINT UNSIGNED NULL AFTER `end_date`,
  ADD COLUMN IF NOT EXISTS `is_active` BOOLEAN NOT NULL DEFAULT true AFTER `winner_id`,
  ADD COLUMN IF NOT EXISTS `created_by` BIGINT UNSIGNED NULL AFTER `is_active`,
  MODIFY COLUMN `created_at` TIMESTAMP(0) NULL AFTER `created_by`,
  MODIFY COLUMN `updated_at` TIMESTAMP(0) NULL AFTER `created_at`;
