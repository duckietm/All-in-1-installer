#!/usr/bin/env bash
# Optimize all tables in mariadb-turbo
cd "$(dirname "$0")/.."
[ -f .env ] && source .env
DB_USER=${MARIADB_USER:-cms}
DB_PASS=${MARIADB_PASSWORD:-cms}
DB_NAME=${MARIADB_DATABASE:-habbo}

echo "Optimizing database tables..."
# Get all tables
tables=$(docker compose exec -T mariadb-turbo mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW TABLES" -s)
# Optimize them
for table in $tables; do
    echo "Optimizing $table..."
    docker compose exec -T mariadb-turbo mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "OPTIMIZE TABLE $table"
done
echo "Optimization complete."
