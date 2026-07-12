#!/usr/bin/env bash
# Runs on the VPS. Rebuilds and (re)starts the worker for a given env.
#
# Invoked by the Makefile via ssh — you shouldn't need to run this by hand.
#
# Usage:  deploy.sh <env>
#         env = "prod" or "staging"

set -euo pipefail

ENV_NAME="${1:?usage: deploy.sh <prod|staging>}"
case "$ENV_NAME" in
  prod|staging) ;;
  *) echo "ERR: env must be 'prod' or 'staging' (got '$ENV_NAME')" >&2; exit 1 ;;
esac

TARGET="$HOME/$ENV_NAME"
[ -d "$TARGET" ] || { echo "ERR: $TARGET does not exist" >&2; exit 1; }
[ -f "$TARGET/.env" ] || { echo "ERR: $TARGET/.env is missing — run push-env.sh first" >&2; exit 1; }

cd "$TARGET"

echo "==> deploy: $ENV_NAME"
docker compose --env-file .env -p "repodcast-$ENV_NAME" pull --ignore-buildable-images 2>/dev/null || true
docker compose --env-file .env -p "repodcast-$ENV_NAME" up -d --build --remove-orphans

echo "==> pruning old images"
docker image prune -f >/dev/null

echo "==> status"
docker compose --env-file .env -p "repodcast-$ENV_NAME" ps
