-- Repair admin ACL so ranks that can open the panel also see/use admin sections.
-- Root cause: sidebar filters by ACL; seed only granted some admin.*.view rows,
-- and later sync from housekeeping could leave mid/high ranks incomplete.

-- 1) Every rank that already has admin.dashboard gets ALL admin.* permissions.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `acl_roles` ar
JOIN `acl_permissions` ap ON ap.slug LIKE 'admin.%'
WHERE EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  JOIN `acl_permissions` apdash ON apdash.id = amp.permission_id
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND apdash.slug = 'admin.dashboard'
)
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp2
  WHERE amp2.model_type = 'Role'
    AND amp2.model_id = ar.id
    AND amp2.permission_id = ap.id
);

-- 2) Safety net matching original seed: ranks >= 6 get all admin.*.view + dashboard.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON (
  ap.slug = 'admin.dashboard'
  OR (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.view')
)
WHERE pr.id >= 6
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);

-- 3) Ranks >= 7 also get edit/manage/execute tools used by the sidebar.
INSERT INTO `acl_model_permissions` (`model_type`, `model_id`, `permission_id`)
SELECT 'Role', ar.id, ap.id
FROM `permission_ranks` pr
JOIN `acl_roles` ar ON ar.slug = CONCAT('rank_', pr.id)
JOIN `acl_permissions` ap ON (
  (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.edit')
  OR ap.slug IN (
    'admin.permissions.manage',
    'admin.rcon.execute',
    'admin.assets.import',
    'admin.export',
    'admin.analytics.export',
    'admin.users.ban',
    'admin.users.reset_password',
    'admin.room.delete'
  )
)
WHERE pr.id >= 7
AND NOT EXISTS (
  SELECT 1
  FROM `acl_model_permissions` amp
  WHERE amp.model_type = 'Role'
    AND amp.model_id = ar.id
    AND amp.permission_id = ap.id
);
