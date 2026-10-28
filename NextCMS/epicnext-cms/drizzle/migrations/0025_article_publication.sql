-- Existing articles remain published. Preserve any publication settings already present.
ALTER TABLE website_articles
 ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published',
 ADD COLUMN IF NOT EXISTS publish_at TIMESTAMP NULL DEFAULT NULL,
 ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_website_articles_publication
 ON website_articles (status, publish_at, created_at);
