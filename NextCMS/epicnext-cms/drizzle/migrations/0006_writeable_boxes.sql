-- CMS-owned editable content boxes (AtomCMS WriteableBox). Rendered on the
-- public site and managed from housekeeping. Idempotent (MariaDB).
CREATE TABLE IF NOT EXISTS website_writeable_boxes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title      VARCHAR(255) NOT NULL,
  icon       VARCHAR(255) NULL,
  content    TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
