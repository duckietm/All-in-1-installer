-- 0008_add_bans_user_id_index.sql
-- Adds an index on bans.user_id to speed up ban lookups by user (used by
-- the access guard on every page request for logged-in users).
CREATE INDEX IF NOT EXISTS `bans_user_id_index` ON `bans` (`user_id`);
