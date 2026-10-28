-- 0021_add_messenger_offline_user_id_index.sql
-- The /me dashboard counts unread offline messages with
-- `WHERE user_id = ?`; messenger_offline previously had no index there.
CREATE INDEX IF NOT EXISTS `idx_messenger_offline_user_id` ON `messenger_offline` (`user_id`);
