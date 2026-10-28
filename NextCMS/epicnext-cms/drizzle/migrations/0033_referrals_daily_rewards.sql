-- 0033_referrals_daily_rewards.sql
-- Referral attribution tables (mirror the live-DB shape used by the existing
-- referral claim flow in src/actions/referral.ts) plus the CMS-owned daily
-- login reward schedule and claim ledger. All CREATE statements are idempotent
-- (IF NOT EXISTS) so fresh installs get the tables and existing hotels keep
-- whatever rows they already have.

CREATE TABLE IF NOT EXISTS `user_referrals` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `referrals_total` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NULL,
    `updated_at` TIMESTAMP NULL,
    PRIMARY KEY (`id`),
    KEY `user_referrals_user_idx` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `referrals` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `referred_user_id` BIGINT UNSIGNED NOT NULL,
    `referred_user_ip` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP NULL,
    `updated_at` TIMESTAMP NULL,
    PRIMARY KEY (`id`),
    KEY `referrals_user_idx` (`user_id`),
    KEY `referrals_referred_user_idx` (`referred_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `claimed_referral_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `ip_address` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP NULL,
    `updated_at` TIMESTAMP NULL,
    PRIMARY KEY (`id`),
    KEY `claimed_referral_logs_user_idx` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily login reward schedule: one row per streak day. The cycle repeats after
-- the highest day (day 1 of the cycle is used for any missing day).
CREATE TABLE IF NOT EXISTS `website_daily_rewards` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `day` INT UNSIGNED NOT NULL DEFAULT 1,
    `currency` VARCHAR(20) NOT NULL DEFAULT 'credits',
    `amount` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `website_daily_rewards_day_uk` (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily reward claims ledger; one row per user per claim date.
CREATE TABLE IF NOT EXISTS `website_daily_reward_claims` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `claim_date` DATE NOT NULL,
    `streak` INT UNSIGNED NOT NULL DEFAULT 1,
    `reward_day` INT UNSIGNED NOT NULL DEFAULT 1,
    `currency` VARCHAR(20) NOT NULL DEFAULT 'credits',
    `amount` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `daily_claim_user_date_uk` (`user_id`, `claim_date`),
    KEY `daily_claim_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed a sensible 7-day reward schedule only when the table is still empty.
INSERT INTO `website_daily_rewards` (`day`, `currency`, `amount`)
SELECT 1, 'duckets', 60
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `website_daily_rewards`);
INSERT INTO `website_daily_rewards` (`day`, `currency`, `amount`)
SELECT 3, 'credits', 50
FROM DUAL
WHERE (SELECT COUNT(*) FROM `website_daily_rewards`) = 1
  AND NOT EXISTS (SELECT 1 FROM `website_daily_rewards` WHERE `day` = 3);
INSERT INTO `website_daily_rewards` (`day`, `currency`, `amount`)
SELECT 5, 'diamonds', 2
FROM DUAL
WHERE (SELECT COUNT(*) FROM `website_daily_rewards`) = 2
  AND NOT EXISTS (SELECT 1 FROM `website_daily_rewards` WHERE `day` = 5);

-- Referral + daily reward configuration defaults (never overwrite an existing
-- value — operators tune these keys in the admin panel).
INSERT INTO `website_settings` (`key`, `value`, `comment`)
SELECT 'referrals_block_same_ip', '1', 'Block referral attribution when the new account shares the inviter IP'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `website_settings` WHERE `key` = 'referrals_block_same_ip');
INSERT INTO `website_settings` (`key`, `value`, `comment`)
SELECT 'daily_reward_enabled', '1', 'Enable the daily login reward claims on /me'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `website_settings` WHERE `key` = 'daily_reward_enabled');

-- New ACL slugs backing the /admin/referrals + /admin/daily-rewards modules.
INSERT INTO `acl_permissions` (`slug`, `title`) VALUES
  ('admin.referrals.view', 'View referrals'),
  ('admin.referrals.edit', 'Edit referrals'),
  ('admin.dailyrewards.view', 'View daily login rewards'),
  ('admin.dailyrewards.edit', 'Edit daily login rewards')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- Grant the new slugs to the same roles that already open the admin panel.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `acl_roles` ar
JOIN `acl_permissions` ap ON ap.slug IN (
  'admin.referrals.view', 'admin.referrals.edit',
  'admin.dailyrewards.view', 'admin.dailyrewards.edit'
)
WHERE EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  JOIN `acl_permissions` apdash ON apdash.id = amp.permission_id
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND apdash.slug = 'admin.dashboard'
)
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp2
  WHERE amp2.model_type = 'Role'
    AND amp2.model_id = ar.id
    AND amp2.permission_id = ap.id
);

-- Safety net matching the 0018 seed: ranks >= 6 view, ranks >= 7 edit.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON ap.slug IN ('admin.referrals.view', 'admin.dailyrewards.view')
WHERE pr.id >= 6
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);

INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON ap.slug IN ('admin.referrals.edit', 'admin.dailyrewards.edit')
WHERE pr.id >= 7
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);