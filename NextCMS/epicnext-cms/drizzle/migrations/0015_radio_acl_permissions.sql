INSERT INTO `acl_permissions` (`slug`, `title`) VALUES
  ('admin.radio.view', 'View radio admin'),
  ('admin.radio.edit', 'Edit radio admin')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- Rank >= 6 gets radio view (matches other admin.*.view grants from 0012).
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON ap.slug = 'admin.radio.view'
WHERE pr.id >= 6
  AND NOT EXISTS (
    SELECT 1 FROM `acl_model_permissions` amp
    WHERE amp.model_type = 'Role'
      AND amp.model_id = ar.id
      AND amp.permission_id = ap.id
  );

-- Highest rank gets radio edit (same pattern as assets.import / permissions.manage).
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
CROSS JOIN `acl_permissions` ap
WHERE pr.id = (SELECT MAX(id) FROM `permission_ranks`)
  AND ap.slug = 'admin.radio.edit'
  AND NOT EXISTS (
    SELECT 1 FROM `acl_model_permissions` amp
    WHERE amp.model_type = 'Role'
      AND amp.model_id = ar.id
      AND amp.permission_id = ap.id
  );
