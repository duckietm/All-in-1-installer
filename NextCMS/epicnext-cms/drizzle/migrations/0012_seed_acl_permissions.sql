-- Seed every permission used by the CMS. Migration 0010 created the ACL
-- tables but did not populate acl_permissions, so migration 0011 could not
-- assign any dashboard permission to rank roles.
INSERT INTO `acl_permissions` (`slug`, `title`) VALUES
  ('admin.dashboard', 'Admin dashboard'),
  ('admin.users.view', 'View users'),
  ('admin.users.edit', 'Edit users'),
  ('admin.users.ban', 'Ban users'),
  ('admin.users.reset_password', 'Reset user passwords'),
  ('admin.room.view', 'View rooms'),
  ('admin.room.edit', 'Edit rooms'),
  ('admin.room.delete', 'Delete rooms'),
  ('admin.bans.view', 'View bans'),
  ('admin.news.view', 'View news'),
  ('admin.news.edit', 'Edit news'),
  ('admin.logs.view', 'View logs'),
  ('admin.settings.view', 'View settings'),
  ('admin.settings.edit', 'Edit settings'),
  ('admin.permissions.manage', 'Manage permissions'),
  ('admin.shop.view', 'View shop'),
  ('admin.shop.edit', 'Edit shop'),
  ('admin.wordfilter.view', 'View word filter'),
  ('admin.wordfilter.edit', 'Edit word filter'),
  ('admin.catalog.view', 'View catalog'),
  ('admin.catalog.edit', 'Edit catalog'),
  ('admin.rcon.execute', 'Execute RCON commands'),
  ('admin.export', 'Export data'),
  ('admin.radio.view', 'View radio admin'),
  ('admin.radio.edit', 'Edit radio admin'),
  ('admin.prefixes.view', 'View prefixes'),
  ('admin.prefixes.edit', 'Edit prefixes'),
  ('admin.tickets.view', 'View tickets'),
  ('admin.tickets.edit', 'Edit tickets'),
  ('admin.moderation.view', 'View moderation'),
  ('admin.moderation.edit', 'Edit moderation'),
  ('admin.events.view', 'View events'),
  ('admin.events.edit', 'Edit events'),
  ('admin.analytics.view', 'View analytics'),
  ('admin.analytics.export', 'Export analytics'),
  ('admin.devops.view', 'View DevOps'),
  ('admin.devops.edit', 'Edit DevOps'),
  ('admin.polls.view', 'View polls'),
  ('admin.polls.edit', 'Edit polls'),
  ('admin.notifications.view', 'View notifications'),
  ('admin.notifications.edit', 'Edit notifications'),
  ('admin.pages.view', 'View CMS pages'),
  ('admin.pages.edit', 'Edit CMS pages'),
  ('admin.banners.view', 'View banners'),
  ('admin.banners.edit', 'Edit banners'),
  ('admin.assets.import', 'Import assets'),
  ('mod.dashboard', 'Moderator dashboard'),
  ('mod.cfh.view', 'View calls for help'),
  ('mod.cfh.edit', 'Manage calls for help'),
  ('mod.actions', 'Execute moderator actions'),
  ('mod.team.view', 'View moderator team'),
  ('mod.tickets.view', 'View moderator tickets'),
  ('mod.tickets.edit', 'Edit moderator tickets'),
  ('mod.users.view', 'View users in moderation'),
  ('mod.bans.view', 'View bans in moderation')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- Keep rank roles synchronized for databases where 0011 already ran.
INSERT INTO `acl_roles` (`slug`, `title`)
SELECT CONCAT('rank_', pr.id), COALESCE(NULLIF(pr.rank_name, ''), CONCAT('Rank ', pr.id))
FROM `permission_ranks` pr
WHERE NOT EXISTS (
  SELECT 1 FROM `acl_roles` ar WHERE ar.slug = CONCAT('rank_', pr.id)
);

-- Preserve moderator access as explicit ACL assignments.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON (
  pr.id >= 3 AND (
    ap.slug = 'mod.dashboard' OR ap.slug = 'mod.actions' OR
    (ap.slug LIKE 'mod.%' AND ap.slug LIKE '%.view')
  )
)
WHERE NOT EXISTS (
  SELECT 1 FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);

-- Preserve administrator read access as explicit ACL assignments.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON (
  pr.id >= 6 AND (
    ap.slug = 'admin.dashboard' OR
    (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.view')
  )
)
WHERE NOT EXISTS (
  SELECT 1 FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);
