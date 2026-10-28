INSERT INTO `acl_permissions` (`slug`, `title`)
VALUES ('housekeeping.preview.access', 'Access Housekeeping preview')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);
