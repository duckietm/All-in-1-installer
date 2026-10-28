-- Add terms/age consent columns expected by the users schema (register flow).
ALTER TABLE `users`
	ADD COLUMN `terms_accepted` TINYINT(1) NOT NULL DEFAULT 0,
	ADD COLUMN `age_verified` TINYINT(1) NOT NULL DEFAULT 0;
