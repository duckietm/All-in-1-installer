CREATE TABLE IF NOT EXISTS `website_event_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `color` VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
    `icon` VARCHAR(50) NOT NULL DEFAULT 'calendar',
    `is_active` INTEGER NOT NULL DEFAULT 1,
    `min_rank` INTEGER NOT NULL DEFAULT 0,
    UNIQUE INDEX `website_event_types_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `type_id` INTEGER NOT NULL,
    `host_user_id` INTEGER NOT NULL,
    `room_id` INTEGER NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NULL,
    `max_players` INTEGER NULL,
    `is_recurring` INTEGER NOT NULL DEFAULT 0,
    `recurrence_rule` VARCHAR(255) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `image` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `website_events_type_id_idx`(`type_id`),
    INDEX `website_events_host_user_id_idx`(`host_user_id`),
    INDEX `website_events_starts_at_idx`(`starts_at`),
    INDEX `website_events_status_idx`(`status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_events_type_id_fkey` FOREIGN KEY (`type_id`) REFERENCES `website_event_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_event_registrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `website_event_registrations_user_id_idx`(`user_id`),
    UNIQUE INDEX `website_event_registrations_event_id_user_id_key`(`event_id`, `user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_event_registrations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `website_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_event_prizes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 1,
    `prize_type` VARCHAR(20) NOT NULL DEFAULT 'badge',
    `badge_code` VARCHAR(50) NULL,
    `credits` INTEGER NOT NULL DEFAULT 0,
    `pixels` INTEGER NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `item_id` INTEGER NULL,
    `description` VARCHAR(255) NOT NULL DEFAULT '',
    INDEX `website_event_prizes_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_event_prizes_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `website_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_event_winners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `website_event_winners_user_id_idx`(`user_id`),
    UNIQUE INDEX `website_event_winners_event_id_user_id_key`(`event_id`, `user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_event_winners_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `website_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_polls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `show_results` INTEGER NOT NULL DEFAULT 1,
    `multiple_choice` INTEGER NOT NULL DEFAULT 0,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `website_polls_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_poll_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poll_id` INTEGER NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'single',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `options` TEXT NOT NULL,
    INDEX `website_poll_questions_poll_id_idx`(`poll_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_poll_questions_poll_id_fkey` FOREIGN KEY (`poll_id`) REFERENCES `website_polls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_poll_votes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `answer` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `website_poll_votes_user_id_idx`(`user_id`),
    UNIQUE INDEX `website_poll_votes_question_id_user_id_key`(`question_id`, `user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `website_poll_votes_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `website_poll_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `website_banners` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL DEFAULT '', `subtitle` VARCHAR(500) NOT NULL DEFAULT '',
  `image` VARCHAR(500) NOT NULL DEFAULT '', `link` VARCHAR(500) NOT NULL DEFAULT '',
  `color` VARCHAR(20) NOT NULL DEFAULT '', `is_active` INT NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0, `start_date` VARCHAR(50) NULL, `end_date` VARCHAR(50) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_prefixes` (
  `id` INT NOT NULL AUTO_INCREMENT, `user_id` INT NOT NULL, `text` VARCHAR(50) NOT NULL,
  `color` VARCHAR(255) NOT NULL DEFAULT '#FFFFFF', `icon` VARCHAR(50) NOT NULL DEFAULT '',
  `effect` VARCHAR(50) NOT NULL DEFAULT '', `active` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), INDEX `idx_custom_prefix_user` (`user_id`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `custom_prefix_blacklist` (
  `id` INT NOT NULL AUTO_INCREMENT, `word` VARCHAR(100) NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_prefix_word` (`word`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `custom_prefix_settings` (
  `key` VARCHAR(100) NOT NULL, `value` TEXT NOT NULL, PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
