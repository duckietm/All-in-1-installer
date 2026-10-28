-- Theme Builder: scoped theme system for per-route, per-module, and multi-site theming.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS theme_scopes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  type        ENUM('global','site','module','route') NOT NULL,
  parent_id   BIGINT UNSIGNED NULL,
  site_domain VARCHAR(255) NULL,
  route_path  VARCHAR(255) NULL,
  module_id   VARCHAR(100) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY theme_scopes_parent_idx (parent_id),
  KEY theme_scopes_type_idx (type),
  UNIQUE KEY theme_scopes_unique_lookup (type, site_domain, route_path, module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS theme_scope_values (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_id     BIGINT UNSIGNED NOT NULL,
  setting_key  VARCHAR(100) NOT NULL,
  setting_val  VARCHAR(255) NOT NULL,
  mode         ENUM('light','dark') NOT NULL DEFAULT 'light',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY theme_scope_values_unique (scope_id, setting_key, mode),
  KEY theme_scope_values_scope_idx (scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: create the global scope from existing website_settings theme data.
INSERT IGNORE INTO theme_scopes (id, name, type, parent_id, is_active, sort_order)
VALUES (1, 'Global', 'global', NULL, 1, 0);
