-- radio_listener_points was created as a stub (id + timestamps only) but the
-- /radio/leaderboard query joins users on user_id and orders by points. Add the
-- real columns. Idempotent (MariaDB ADD COLUMN / INDEX IF NOT EXISTS).
ALTER TABLE radio_listener_points
  ADD COLUMN IF NOT EXISTS user_id INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points  INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS radio_listener_points_points_idx ON radio_listener_points (points);
