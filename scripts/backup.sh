#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to run backups." >&2
  exit 1
}

docker compose version >/dev/null

if [[ ! -f .env ]]; then
  echo ".env file not found in project root." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
mkdir -p "${BACKUP_DIR}"
backup_name="portal-$(date -u +%Y%m%dT%H%M%SZ).dump"
backup_path="${BACKUP_DIR}/${backup_name}"

docker compose run --rm -T backend sh -lc 'pg_dump "$MIGRATION_DATABASE_URL" --format=custom' > "${backup_path}"
find "${BACKUP_DIR}" -type f -name 'portal-*.dump' -mtime +14 -delete
printf 'Backup created: %s\n' "${backup_path}"