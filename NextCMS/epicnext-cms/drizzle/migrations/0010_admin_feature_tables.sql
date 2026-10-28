-- CMS-owned tables required by the restored administration modules.
-- Idempotent and deliberately free of foreign keys so it can be applied to
-- existing emulator databases whose users table may use different engines.

CREATE TABLE IF NOT EXISTS website_tickets (
  id INT NOT NULL AUTO_INCREMENT,
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  creator_id INT NOT NULL,
  assignee_id INT NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY website_tickets_creator_idx (creator_id),
  KEY website_tickets_assignee_idx (assignee_id),
  KEY website_tickets_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS website_ticket_messages (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  user_id INT NOT NULL,
  message TEXT NOT NULL,
  is_staff INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY website_ticket_messages_ticket_idx (ticket_id),
  KEY website_ticket_messages_user_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS website_ticket_templates (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_watch (
  id INT NOT NULL AUTO_INCREMENT,
  staff_id INT NOT NULL,
  target_user_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_watch_unique (staff_id, target_user_id),
  KEY user_watch_target_idx (target_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  action VARCHAR(191) NOT NULL DEFAULT '',
  target VARCHAR(191) NOT NULL DEFAULT '',
  target_id INT NULL,
  details TEXT NULL,
  `before` TEXT NULL,
  `after` TEXT NULL,
  diff TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at VARCHAR(64) NOT NULL DEFAULT '',
  updated_at VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY admin_audit_log_user_idx (user_id),
  KEY admin_audit_log_target_idx (target, target_id),
  KEY admin_audit_log_action_idx (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acl_roles (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY acl_roles_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acl_permissions (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY acl_permissions_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acl_model_roles (
  id INT NOT NULL AUTO_INCREMENT,
  model_type VARCHAR(191) NOT NULL DEFAULT 'User',
  model_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (id),
  KEY acl_model_roles_role_idx (role_id),
  UNIQUE KEY acl_model_roles_unique (model_type, model_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acl_model_permissions (
  id INT NOT NULL AUTO_INCREMENT,
  model_type VARCHAR(191) NOT NULL DEFAULT 'Role',
  model_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (id),
  KEY acl_model_permissions_model_idx (model_id),
  KEY acl_model_permissions_permission_idx (permission_id),
  UNIQUE KEY acl_model_permissions_unique (model_type, model_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
