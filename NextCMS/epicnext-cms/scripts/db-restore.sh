#!/usr/bin/env bash
# Restore database from a backup
cd "$(dirname "$0")/.."
BACKUP_DIR="backups"

echo "Available backups:"
ls -1 "$BACKUP_DIR"

read -p "Enter filename to restore: " filename

if [ -f "$BACKUP_DIR/$filename" ]; then
    echo "Restoring $filename..."
    [ -f .env ] && source .env
    DB_USER=${MARIADB_USER:-cms}
    DB_PASS=${MARIADB_PASSWORD:-cms}
    DB_NAME=${MARIADB_DATABASE:-habbo}

    docker compose exec -T mariadb-turbo mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$BACKUP_DIR/$filename"
    echo "Restore complete."
else
    echo "File not found."
fi
