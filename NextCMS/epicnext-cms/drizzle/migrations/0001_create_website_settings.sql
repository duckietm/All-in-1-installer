-- CMS-owned settings table. Idempotent: safe to re-run.
-- Mirrors AtomCMS's Laravel `website_settings` (key UNIQUE, value TEXT).
CREATE TABLE IF NOT EXISTS website_settings (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key`   VARCHAR(255) NOT NULL,
  value   TEXT NOT NULL,
  comment VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY website_settings_key_unique (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
