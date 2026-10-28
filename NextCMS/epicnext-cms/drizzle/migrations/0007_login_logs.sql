-- Successful-login history (the AtomCMS "session logs" equivalent; our auth is
-- stateless JWT so there's no sessions table). Idempotent (MariaDB).
CREATE TABLE IF NOT EXISTS website_login_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT NOT NULL,
  ip         VARCHAR(45) NOT NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY website_login_logs_user_id_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
