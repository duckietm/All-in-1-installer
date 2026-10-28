UPDATE `acl_model_permissions` SET `model_type` = 'Role' WHERE LOWER(`model_type`) = 'role';
UPDATE `acl_model_roles` SET `model_type` = 'User' WHERE LOWER(`model_type`) = 'user';

INSERT INTO `acl_permissions` (`slug`, `title`) VALUES
  ('admin.assets.import', 'Import assets'),
  ('admin.permissions.manage', 'Manage permissions')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

INSERT INTO `acl_roles` (`slug`, `title`, `description`)
SELECT CONCAT('rank_', pr.id), COALESCE(NULLIF(pr.rank_name, ''), CONCAT('Rank ', pr.id)), 'CMS role synchronized from permission_ranks'
FROM `permission_ranks` pr
WHERE NOT EXISTS (SELECT 1 FROM `acl_roles` ar WHERE ar.slug = CONCAT('rank_', pr.id));

INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
CROSS JOIN `acl_permissions` ap
WHERE pr.id = (SELECT MAX(id) FROM `permission_ranks`)
  AND ap.slug IN ('admin.permissions.manage', 'admin.assets.import')
  AND NOT EXISTS (
    SELECT 1 FROM `acl_model_permissions` amp
    WHERE amp.model_type = 'Role' AND amp.model_id = ar.id AND amp.permission_id = ap.id
  );

INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `website_housekeeping_permissions` whp
JOIN `acl_permissions` ap ON ap.slug = whp.permission
JOIN `permission_ranks` pr ON pr.id >= whp.min_rank
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
WHERE NOT EXISTS (
  SELECT 1 FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role' AND amp.model_id = ar.id AND amp.permission_id = ap.id
);
