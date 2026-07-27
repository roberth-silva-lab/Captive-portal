#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to deploy this project." >&2
  exit 1
}

docker compose version >/dev/null

if [[ ! -f .env ]]; then
  echo ".env file not found in project root." >&2
  exit 1
fi

docker compose config >/dev/null
docker compose build
docker compose up -d

printf 'Waiting for backend readiness'
for _ in {1..30}; do
  if docker compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)" >/dev/null 2>&1; then
    echo " ok"
    docker compose ps
    exit 0
  fi
  printf '.'
  sleep 2
done

echo " readiness check failed" >&2
docker compose logs --tail=100 backend >&2
exit 1