#!/usr/bin/env bash
set -euo pipefail
ROOT=${ROOT:-/opt/portal}
cd "$ROOT"
command -v docker >/dev/null || { echo "Docker not found"; exit 1; }
docker compose config >/dev/null
[ -f .env ] || { echo ".env missing"; exit 1; }
docker compose build
./scripts/migrate.sh
docker compose up -d
printf 'Waiting for backend health'
for i in {1..30}; do
  if docker compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)"; then
    echo " ok"
    docker compose ps
    exit 0
  fi
  printf '.'
  sleep 2
done
echo " healthcheck failed"
docker compose logs --tail=100 backend
exit 1
