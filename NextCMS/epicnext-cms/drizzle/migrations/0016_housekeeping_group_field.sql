ALTER TABLE `website_housekeeping_permissions`
  ADD COLUMN `group_name` VARCHAR(100) DEFAULT NULL AFTER `description`,
  ADD COLUMN `depends_on` VARCHAR(255) DEFAULT NULL AFTER `group_name`,
  ADD COLUMN `updated_by` INT DEFAULT NULL AFTER `updated_at`;

-- Migration tracking (no model change needed for audit log usage)
