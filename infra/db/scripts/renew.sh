#!/usr/bin/env bash
# VPS-side cert lifecycle for the DB stack.
#   - First run: issues a cert via lego + Cloudflare DNS-01.
#   - Subsequent runs: no-op if cert has >30d remaining; otherwise renews.
# After a successful (re)issue, reloads Postgres SSL config and restarts
# pgbouncer to pick up the new cert.
#
# Reads secrets from ~/db-<env>/.env — must include:
#   CLOUDFLARE_DNS_API_TOKEN, DB_DOMAIN, LEGO_EMAIL (optional, has default)
#
# Usage:  renew.sh <prod|staging>
#
# Called by cron (installed by deploy.sh) and safe to run manually any time.

set -euo pipefail

ENV_NAME="${1:?usage: renew.sh <prod|staging>}"
case "$ENV_NAME" in
  prod|staging) ;;
  *) echo "ERR: env must be 'prod' or 'staging' (got '$ENV_NAME')" >&2; exit 1 ;;
esac

TARGET="$HOME/db-$ENV_NAME"
PROJECT="repodcast-db-$ENV_NAME"
CERT_DIR="$TARGET/certs"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
LEGO_DATA="$TARGET/lego-data"
LOG_FILE="$TARGET/renew.log"

RENEW_WITHIN_DAYS="${RENEW_WITHIN_DAYS:-30}"
LEGO_IMAGE="${LEGO_IMAGE:-goacme/lego:latest}"

log() {
  printf '%s [%s] %s\n' "$(date -Iseconds)" "$ENV_NAME" "$*" | tee -a "$LOG_FILE"
}

# Load specific vars from .env. We deliberately do NOT `. .env` because some
# values (BACKUP_SCHEDULE, SCHEDULE, cron expressions) contain characters
# bash treats as shell metacharacters (`*`, spaces). docker-compose's
# env_file parser reads whole-line values as-is and is unaffected.
[ -f "$TARGET/.env" ] || { echo "ERR: $TARGET/.env is missing" >&2; exit 1; }

env_val() {
  local key="$1"
  awk -v k="$key" -F= '$1 == k { sub(/^[^=]+=/, ""); print; exit }' "$TARGET/.env" | tr -d '\r'
}

CLOUDFLARE_DNS_API_TOKEN="$(env_val CLOUDFLARE_DNS_API_TOKEN)"
DB_DOMAIN="$(env_val DB_DOMAIN)"
LEGO_EMAIL="$(env_val LEGO_EMAIL)"
POSTGRES_USER="$(env_val POSTGRES_USER)"
POSTGRES_DB="$(env_val POSTGRES_DB)"

: "${CLOUDFLARE_DNS_API_TOKEN:?CLOUDFLARE_DNS_API_TOKEN missing from .env}"
: "${DB_DOMAIN:?DB_DOMAIN missing from .env (e.g. db.repodcastapp.com)}"
LEGO_EMAIL="${LEGO_EMAIL:-contact@repodcastapp.com}"

needs_renewal() {
  if [ ! -f "$CERT_FILE" ]; then
    log "no cert at $CERT_FILE — will issue"
    return 0
  fi
  # If DB_DOMAIN changed since the cert was issued (e.g. someone renamed the
  # hostname), the current cert no longer covers it — force a reissue so
  # PgBouncer's TLS matches what clients expect.
  if ! openssl x509 -in "$CERT_FILE" -noout -checkhost "$DB_DOMAIN" >/dev/null 2>&1; then
    log "cert doesn't cover $DB_DOMAIN — will reissue"
    return 0
  fi
  local seconds=$((RENEW_WITHIN_DAYS * 24 * 3600))
  if openssl x509 -checkend "$seconds" -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    local end_epoch now_epoch days_left
    end_epoch=$(date -d "$(openssl x509 -noout -enddate -in "$CERT_FILE" | cut -d= -f2)" +%s)
    now_epoch=$(date +%s)
    days_left=$(( (end_epoch - now_epoch) / 86400 ))
    log "cert valid for $days_left more days (threshold $RENEW_WITHIN_DAYS) — no action"
    return 1
  fi
  log "cert expires within $RENEW_WITHIN_DAYS days — will renew"
  return 0
}

run_lego() {
  mkdir -p "$LEGO_DATA"
  log "pulling $LEGO_IMAGE"
  docker pull -q "$LEGO_IMAGE" >/dev/null
  log "running lego for $DB_DOMAIN"
  # goacme/lego is a scratch image with the lego binary at /lego, so we
  # mount our persistent state at /data and point --path there.
  # lego v5 CLI: `run` is a subcommand and `--path`/`--dns`/etc. are its
  # options — `run` must come FIRST, not last.
  #
  # --user makes lego write files as the host `deploy` user rather than root,
  # so subsequent [ -f ... ] checks and installs work without sudo.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$LEGO_DATA:/data" \
    -e "CLOUDFLARE_DNS_API_TOKEN=$CLOUDFLARE_DNS_API_TOKEN" \
    "$LEGO_IMAGE" \
    run \
    --path /data \
    --accept-tos \
    --email "$LEGO_EMAIL" \
    --domains "$DB_DOMAIN" \
    --dns cloudflare \
    --dns.resolvers 1.1.1.1:53 \
    --dns.resolvers 8.8.8.8:53
}

install_cert() {
  local src_crt="$LEGO_DATA/certificates/${DB_DOMAIN}.crt"
  local src_key="$LEGO_DATA/certificates/${DB_DOMAIN}.key"
  [ -f "$src_crt" ] || { log "ERROR: lego did not produce $src_crt"; return 1; }
  [ -f "$src_key" ] || { log "ERROR: lego did not produce $src_key"; return 1; }

  mkdir -p "$CERT_DIR"
  # rm+cp instead of overwrite-in-place — cp requires write on target file
  # (which may not exist yet) whereas rm requires only dir write (we own the dir).
  rm -f "$CERT_FILE" "$KEY_FILE"
  cp "$src_crt" "$CERT_FILE"
  cp "$src_key" "$KEY_FILE"
  # 644 on the key too — different container images (postgres, pgbouncer)
  # run as different uids that don't match `deploy`. The key never leaves
  # this single-tenant VPS. If you host on shared infra, revisit this.
  chmod 644 "$CERT_FILE" "$KEY_FILE"
  log "cert installed to $CERT_DIR"
}

reload_stack() {
  # No-op if pgbouncer isn't up yet (first-time issue before initial `docker compose up`).
  # Only pgbouncer terminates TLS — postgres SSL is off, so no reload there.
  if ! docker compose --env-file "$TARGET/.env" -p "$PROJECT" ps --status running --services 2>/dev/null | grep -qx pgbouncer; then
    log "pgbouncer not running — skipping reload (will pick up cert on next docker compose up)"
    return 0
  fi

  log "restarting pgbouncer to pick up new cert"
  docker compose --env-file "$TARGET/.env" -p "$PROJECT" restart pgbouncer >/dev/null
}

main() {
  mkdir -p "$(dirname "$LOG_FILE")"

  if ! needs_renewal; then
    exit 0
  fi

  run_lego
  install_cert
  reload_stack
  log "renewal complete"
}

main "$@"
