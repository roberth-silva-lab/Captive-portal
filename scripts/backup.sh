#!/usr/bin/env bash
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-/opt/portal/backups}
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/portal-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$MIGRATION_DATABASE_URL" --format=custom --file="$file"
find "$BACKUP_DIR" -type f -name 'portal-*.dump' -mtime +14 -delete
printf 'Backup created: %s\n' "$file"
