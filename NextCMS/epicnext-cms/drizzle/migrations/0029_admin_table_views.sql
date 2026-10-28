CREATE TABLE IF NOT EXISTS website_admin_table_views (
 user_id INT NOT NULL,
 path VARCHAR(191) NOT NULL,
 name VARCHAR(60) NOT NULL,
 state TEXT NOT NULL,
 PRIMARY KEY (user_id, path, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
