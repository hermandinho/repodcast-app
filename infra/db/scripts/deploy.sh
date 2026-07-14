#!/usr/bin/env bash
# Runs on the VPS. Rebuilds and (re)starts the DB stack for a given env.
#
# Invoked by push.ps1 over ssh — you shouldn't need to run this by hand.
#
# Usage:  deploy.sh <env>
#         env = "prod" or "staging"

set -euo pipefail

ENV_NAME="${1:?usage: deploy.sh <prod|staging>}"
case "$ENV_NAME" in
  prod|staging) ;;
  *) echo "ERR: env must be 'prod' or 'staging' (got '$ENV_NAME')" >&2; exit 1 ;;
esac

TARGET="$HOME/db-$ENV_NAME"
[ -d "$TARGET" ] || { echo "ERR: $TARGET does not exist" >&2; exit 1; }
[ -f "$TARGET/.env" ] || { echo "ERR: $TARGET/.env is missing — run push.ps1 first" >&2; exit 1; }
[ -f "$TARGET/rclone/rclone.conf" ] || { echo "ERR: $TARGET/rclone/rclone.conf is missing" >&2; exit 1; }
[ -x "$TARGET/scripts/renew.sh" ] || { echo "ERR: $TARGET/scripts/renew.sh is missing or not executable" >&2; exit 1; }

cd "$TARGET"

# Normalize .env in place. Handles common paste-from-Windows footguns:
#   - CRLF line endings (bash sourcing chokes; lego sends \r in HTTP headers)
#   - Trailing whitespace on values
#   - Surrounding quotes: KEY="value" or KEY='value' (docker-compose's env_file
#     treats quotes as literal characters — always wrong)
# Idempotent, cheap. Runs on every deploy.
sed -i -E 's/[[:space:]]+$//'                          "$TARGET/.env"
sed -i -E 's/^([A-Z_][A-Z0-9_]*)="(.*)"$/\1=\2/'      "$TARGET/.env"
sed -i -E "s/^([A-Z_][A-Z0-9_]*)='(.*)'\$/\1=\2/"     "$TARGET/.env"

# --- Cert bootstrap ---------------------------------------------------------
# renew.sh handles both first-time issue and renewal via lego + Cloudflare DNS-01.
# If certs already exist and are fresh, this is a no-op.
if [ ! -f "$TARGET/certs/fullchain.pem" ] || [ ! -f "$TARGET/certs/privkey.pem" ]; then
  echo "==> no certs found — issuing via renew.sh"
  bash "$TARGET/scripts/renew.sh" "$ENV_NAME"
fi

# pg_hba/postgresql.conf need to be readable by the postgres user inside
# the container. Bind-mounted files inherit host ownership.
chmod 644 postgres/*.conf
# certs are managed by renew.sh — it sets 644 on both files.

echo "==> deploy: db-$ENV_NAME"
docker compose --env-file .env -p "repodcast-db-$ENV_NAME" pull --ignore-buildable-images 2>/dev/null || true
docker compose --env-file .env -p "repodcast-db-$ENV_NAME" up -d --remove-orphans

echo "==> pruning old images"
docker image prune -f >/dev/null

# --- Ensure app database exists ---------------------------------------------
# Postgres only creates POSTGRES_DB on the FIRST init of an empty data volume.
# If the volume was initialized before POSTGRES_DB was set correctly (early
# iteration, aborted attempts), the DB won't exist on subsequent boots.
# Idempotent CREATE DATABASE guards against that.
env_val() {
  awk -v k="$1" -F= '$1 == k { sub(/^[^=]+=/, ""); print; exit }' "$TARGET/.env" | tr -d '\r'
}
DB_USER="$(env_val POSTGRES_USER)"
DB_NAME="$(env_val POSTGRES_DB)"
DB_PASS="$(env_val POSTGRES_PASSWORD)"
CONTAINER="repodcast-db-${ENV_NAME}-postgres-1"

# Wait for postgres to accept connections (healthcheck should have already
# gated `docker compose up`, but be defensive if start_period was tight).
for _ in $(seq 1 20); do
  docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
  sleep 1
done

DB_EXISTS=$(docker exec -e PGPASSWORD="$DB_PASS" "$CONTAINER" \
  psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | tr -d '[:space:]')
if [ "$DB_EXISTS" != "1" ]; then
  echo "==> creating database \"$DB_NAME\""
  docker exec -e PGPASSWORD="$DB_PASS" "$CONTAINER" \
    psql -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\"" >/dev/null
fi

# --- Cron for daily cert-renewal check --------------------------------------
# Idempotent: matches on the marker string, replaces or adds as needed.
# The `|| true` after grep handles the empty-crontab case — grep -v exits 1
# when input is empty, which under `set -euo pipefail` would kill the script.
CRON_MARKER="# repodcast-db-renew:$ENV_NAME"
CRON_LINE="15 3 * * * $TARGET/scripts/renew.sh $ENV_NAME >> $TARGET/renew.log 2>&1 $CRON_MARKER"
(crontab -l 2>/dev/null | grep -vF "$CRON_MARKER" || true; echo "$CRON_LINE") | crontab -
echo "==> cron: daily cert-renewal check installed (03:15, logs to $TARGET/renew.log)"

echo "==> status"
docker compose --env-file .env -p "repodcast-db-$ENV_NAME" ps
