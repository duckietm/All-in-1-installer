-- Fortify-style 2FA columns on the emulator users table. Idempotent (MariaDB).
-- AtomCMS installs already have these; this only adds them when missing.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT NULL,
  ADD COLUMN IF NOT EXISTS two_factor_recovery_codes TEXT NULL,
  ADD COLUMN IF NOT EXISTS two_factor_confirmed_at TIMESTAMP NULL;
