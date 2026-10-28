-- 0020_performance_indexes.sql
-- Adds indexes for the hot CMS read paths (shared DB with the Arcturus
-- emulator — additive only, no schema changes to emulator-owned columns).
--
--   users.credits                     → credits leaderboard (ORDER BY credits DESC LIMIT 20)
--   users_currency(type, amount)      → duckets/diamonds leaderboard (WHERE type=? ORDER BY amount DESC LIMIT 20)
--   users_settings.respects_received  → respects leaderboard (ORDER BY respects_received DESC LIMIT 20)
--   camera_web.timestamp              → homepage recent photos (ORDER BY timestamp DESC LIMIT 4)
CREATE INDEX IF NOT EXISTS `idx_users_credits` ON `users` (`credits`);
CREATE INDEX IF NOT EXISTS `idx_users_currency_type_amount` ON `users_currency` (`type`, `amount`);
CREATE INDEX IF NOT EXISTS `idx_users_settings_respects_received` ON `users_settings` (`respects_received`);
CREATE INDEX IF NOT EXISTS `idx_camera_web_timestamp` ON `camera_web` (`timestamp`);
