-- Repair the escalation introduced by 0018's rule 1 ("has admin.dashboard gets
-- ALL admin.*"). Migrating 0011 grants admin.dashboard to every rank >= 6 so
-- that the sidebar opens, which meant rank 6 silently acquired
-- admin.permissions.manage, admin.rcon.execute, admin.settings.edit,
-- admin.users.edit, admin.users.reset_password, admin.room.delete, ...
--
-- Rule 1 is narrowed to `admin.%.view` (read-only, all the sidebar needs) in
-- both the migration set and the runtime repair action. This migration undoes
-- the over-grant on databases that already ran 0018: every role below the top
-- rank keeps dashboard + *.view and loses every other admin.* grant. Ranks
-- that legitimately hold tools keep them, because rule 3 only targets
-- rank >= 7 and those roles are not touched here.
--
-- Note on the rank extraction: `acl_roles.slug` looks like `rank_7`, and
-- MySQL's SUBSTRING is 1-based, so the digits start at position 6 — right
-- after the 5-character `rank_`. Reading from position 7 truncates the first
-- digit, which turns rank_10 into 0 and rank_7 into an empty string, i.e. both
-- would compare as < 7 and lose grants this migration is supposed to preserve.
-- The REGEXP guard below guarantees the remainder really is all digits.

DELETE `amp`
FROM `acl_model_permissions` `amp`
JOIN `acl_roles` `ar`
  ON `ar`.`id` = `amp`.`model_id`
 AND `amp`.`model_type` = 'Role'
JOIN `acl_permissions` `ap`
  ON `ap`.`id` = `amp`.`permission_id`
WHERE `ap`.`slug` LIKE 'admin.%'
  AND `ap`.`slug` NOT LIKE '%.view'
  AND `ar`.`slug` REGEXP '^rank_[0-9]+$'
  AND CAST(SUBSTRING(`ar`.`slug`, 6) AS UNSIGNED) < 7;