-- Preserve complete before/after snapshots for long news articles.
ALTER TABLE admin_audit_log MODIFY COLUMN `before` MEDIUMTEXT NULL, MODIFY COLUMN `after` MEDIUMTEXT NULL;
