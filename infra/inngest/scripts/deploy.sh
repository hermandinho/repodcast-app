#!/usr/bin/env bash
# Runs on the VPS. Brings up (or reloads) the Inngest stack.
# Invoked by push.ps1 over ssh — you shouldn't need to run this by hand.

set -euo pipefail

TARGET="$HOME/inngest-prod"
[ -d "$TARGET" ]                       || { echo "ERR: $TARGET does not exist" >&2; exit 1; }
[ -f "$TARGET/.env" ]                  || { echo "ERR: $TARGET/.env is missing — run push.ps1 first" >&2; exit 1; }
[ -f "$TARGET/rclone/rclone.conf" ]    || { echo "ERR: $TARGET/rclone/rclone.conf is missing" >&2; exit 1; }
[ -f "$TARGET/docker-compose.yml" ]    || { echo "ERR: $TARGET/docker-compose.yml is missing" >&2; exit 1; }

cd "$TARGET"

# Normalize .env in place. Same paste-from-Windows footguns as db/deploy.sh:
#   - CRLF line endings
#   - Trailing whitespace on values
#   - Surrounding quotes: KEY="value" — docker-compose treats them as literal
sed -i -E 's/[[:space:]]+$//'                     "$TARGET/.env"
sed -i -E 's/^([A-Z_][A-Z0-9_]*)="(.*)"$/\1=\2/'  "$TARGET/.env"
sed -i -E "s/^([A-Z_][A-Z0-9_]*)='(.*)'\$/\1=\2/" "$TARGET/.env"

echo "==> deploy: inngest-prod"
docker compose --env-file .env -p "repodcast-inngest-prod" pull --ignore-buildable-images 2>/dev/null || true
docker compose --env-file .env -p "repodcast-inngest-prod" up -d --remove-orphans

echo "==> pruning old images"
docker image prune -f >/dev/null

echo "==> status"
docker compose --env-file .env -p "repodcast-inngest-prod" ps
