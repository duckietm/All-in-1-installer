-- Normalize ACL discriminator casing and ensure every emulator rank has a CMS role.
UPDATE `acl_model_permissions` SET `model_type` = 'Role' WHERE LOWER(`model_type`) = 'role';
UPDATE `acl_model_roles` SET `model_type` = 'User' WHERE LOWER(`model_type`) = 'user';

INSERT INTO `acl_roles` (`slug`, `title`, `description`)
SELECT CONCAT('rank_', pr.id), COALESCE(NULLIF(pr.rank_name, ''), CONCAT('Rank ', pr.id)), 'CMS role synchronized from permission_ranks'
FROM `permission_ranks` pr
WHERE NOT EXISTS (SELECT 1 FROM `acl_roles` ar WHERE ar.slug = CONCAT('rank_', pr.id));

-- Preserve the former moderator fallback as explicit ACL data.
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
  WHERE amp.model_type = 'Role' AND amp.model_id = ar.id AND amp.permission_id = ap.id
);

-- Preserve the former administrator read-only fallback as explicit ACL data.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON (
  pr.id >= 6 AND (ap.slug = 'admin.dashboard' OR (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.view'))
)
WHERE NOT EXISTS (
  SELECT 1 FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role' AND amp.model_id = ar.id AND amp.permission_id = ap.id
);
