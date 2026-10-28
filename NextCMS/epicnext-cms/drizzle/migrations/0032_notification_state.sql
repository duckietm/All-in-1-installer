CREATE TABLE IF NOT EXISTS `website_notification_reads` (
 `user_id` int NOT NULL,
 `event_key` varchar(128) NOT NULL,
 `read_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (`user_id`, `event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `website_notification_preferences` (
 `user_id` int NOT NULL,
 `support` boolean NOT NULL DEFAULT true,
 `friends` boolean NOT NULL DEFAULT true,
 `events` boolean NOT NULL DEFAULT true,
 PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
