CREATE TABLE IF NOT EXISTS `website_profile_privacy` (
 `user_id` int NOT NULL,
 `wallet` boolean NOT NULL DEFAULT false,
 `online` boolean NOT NULL DEFAULT true,
 `friends` boolean NOT NULL DEFAULT true,
 `photos` boolean NOT NULL DEFAULT true,
 `registered` boolean NOT NULL DEFAULT true,
 PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
