-- 0036_used_vouchers_unique.sql
-- One redemption per user and voucher, enforced by the database.
--
-- The redeem action checked for an earlier use and then inserted, so parallel
-- requests could each pass the check and each be credited. With this key the
-- second insert fails and its transaction (which also claims the use) rolls back.
--
-- Rows from such races already in the table would stop the key from being added:
-- keep the oldest row of each user/voucher pair.
DELETE newer FROM `website_used_shop_vouchers` newer
JOIN `website_used_shop_vouchers` older
  ON older.user_id = newer.user_id
 AND older.voucher_id = newer.voucher_id
 AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS `website_used_shop_vouchers_user_voucher_uk`
  ON `website_used_shop_vouchers` (`user_id`, `voucher_id`);
