-- CMS JWT invalidation counter on users (stateless NextAuth sessions).
-- Idempotent (MariaDB).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS website_jwt_version INT NOT NULL DEFAULT 0;
