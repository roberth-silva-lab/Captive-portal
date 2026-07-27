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

docker compose run --rm -T backend sh -lc 'cd /app && alembic upgrade head'