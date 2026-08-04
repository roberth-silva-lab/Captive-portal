#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to run migrations." >&2
  exit 1
}

docker compose version >/dev/null

if [[ ! -f .env ]]; then
  echo ".env file not found in project root." >&2
  exit 1
fi

migration_command='cd /app && alembic upgrade head && current="$(alembic current | awk "{print \$1}")" && head="$(alembic heads | awk "{print \$1}")" && alembic current && alembic heads && test "$current" = "$head"'

if [[ -n "$(docker compose ps --status running -q backend 2>/dev/null)" ]]; then
  docker compose exec -T backend sh -lc "$migration_command"
else
  docker compose run --rm -T backend sh -lc "$migration_command"
fi
