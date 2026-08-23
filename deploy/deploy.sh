#!/usr/bin/env bash
# Deploy/redeploy the ELK API on the EC2 host.
#
#   ./deploy/deploy.sh          # build, migrate, restart from the current checkout
#   ./deploy/deploy.sh --pull   # git pull first
#
# Safe to re-run. Migrations run before the new container starts, so the app
# never boots against a schema it does not know about.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml)

if [[ ! -f .env ]]; then
  echo "deploy/.env is missing — copy .env.production.example to .env and fill it in." >&2
  exit 1
fi

if [[ "${1:-}" == "--pull" ]]; then
  echo "==> Pulling latest code"
  git -C .. pull --ff-only
fi

echo "==> Building images"
"${COMPOSE[@]}" build api migrate

echo "==> Starting Redis"
"${COMPOSE[@]}" up -d redis

echo "==> Applying database migrations (RDS)"
"${COMPOSE[@]}" --profile tools run --rm migrate

echo "==> Starting API"
"${COMPOSE[@]}" up -d api

echo "==> Waiting for readiness"
port="$(grep -E '^API_HOST_PORT=' .env | cut -d= -f2 | tr -d '[:space:]')"
port="${port:-3000}"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port}/health/ready" >/dev/null 2>&1; then
    echo "==> Healthy: $(curl -fsS "http://127.0.0.1:${port}/health/ready")"
    # Drop images orphaned by this build.
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "API did not become ready in 60s. Recent logs:" >&2
"${COMPOSE[@]}" logs --tail=50 api >&2
exit 1
