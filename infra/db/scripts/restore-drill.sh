#!/usr/bin/env bash
# Restore the newest local backup into a throwaway container and assert
# the DB isn't empty. Run monthly via cron on the VPS.
#
# Usage:  restore-drill.sh <env>
#         env = "prod" or "staging"
#
# Suggested cron (as `deploy` on the VPS):
#   0 5 1 * *  /home/deploy/db-prod/scripts/restore-drill.sh prod >> /home/deploy/restore-drill.log 2>&1

set -euo pipefail

ENV_NAME="${1:?usage: restore-drill.sh <prod|staging>}"
case "$ENV_NAME" in
  prod|staging) ;;
  *) echo "ERR: env must be 'prod' or 'staging'" >&2; exit 1 ;;
esac

TARGET="$HOME/db-$ENV_NAME"
BACKUP_DIR="$TARGET/backups/daily"
PROJECT="repodcast-db-$ENV_NAME"

# Load specific vars from .env (avoid `. .env` — see comment in renew.sh).
env_val() {
  local key="$1"
  awk -v k="$key" -F= '$1 == k { sub(/^[^=]+=/, ""); print; exit }' "$TARGET/.env" | tr -d '\r'
}
POSTGRES_USER="$(env_val POSTGRES_USER)"
POSTGRES_DB="$(env_val POSTGRES_DB)"

NEWEST=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n1 || true)
if [ -z "$NEWEST" ]; then
  echo "ERR: no dumps found in $BACKUP_DIR" >&2
  exit 1
fi

echo "==> restore drill against: $NEWEST"

DRILL_CONTAINER="repodcast-db-drill-$ENV_NAME-$$"
DRILL_PASS=$(openssl rand -hex 16)

cleanup() {
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm \
  --name "$DRILL_CONTAINER" \
  --network "${PROJECT}_default" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$DRILL_PASS" \
  postgres:17-alpine >/dev/null

echo "==> waiting for drill container to accept connections"
for _ in $(seq 1 30); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> restoring dump"
gunzip -c "$NEWEST" | docker exec -i "$DRILL_CONTAINER" \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --clean --if-exists

echo "==> sanity checks"
TABLE_COUNT=$(docker exec "$DRILL_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "    tables in public schema: $TABLE_COUNT"

if [ "$TABLE_COUNT" -lt 10 ]; then
  echo "FAIL: expected >=10 tables in restored DB, got $TABLE_COUNT" >&2
  exit 1
fi

echo "==> PASS ($(basename "$NEWEST"), $TABLE_COUNT tables)"
