#!/usr/bin/env bash
# Backup mariadb-turbo database
cd "$(dirname "$0")/.."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILE="$BACKUP_DIR/db_$TIMESTAMP.sql"

echo "Creating database backup in: $FILE"

# Use environment variables from .env if possible
if [ -f .env ]; then
  source .env
fi

# Use the credentials from environment or defaults
DB_USER=${MARIADB_USER:-cms}
DB_PASS=${MARIADB_PASSWORD:-cms}
DB_NAME=${MARIADB_DATABASE:-habbo}

docker compose exec -T mariadb-turbo mariadbdump -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$FILE"

echo "Backup complete: $FILE"
