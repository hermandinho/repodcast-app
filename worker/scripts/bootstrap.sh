#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu VPS for the Repodcast render worker.
#
# Idempotent — safe to re-run at any time. Every step checks its own state
# before mutating anything, so you can also re-run this to recover a box
# whose state has drifted.
#
# USAGE (from your laptop, running against a fresh box):
#   # Option A — pipe over SSH, key comes from root's authorized_keys
#   ssh root@<ip> 'bash -s' < worker/scripts/bootstrap.sh
#
#   # Option B — supply your public key explicitly (recommended)
#   DEPLOY_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
#     ssh root@<ip> 'DEPLOY_PUBLIC_KEY=$0 bash -s' -- "$DEPLOY_PUBLIC_KEY" \
#     < worker/scripts/bootstrap.sh
#
#   # Option C — copy the file to the box and run it locally
#   scp worker/scripts/bootstrap.sh root@<ip>:/tmp/
#   ssh root@<ip> "DEPLOY_PUBLIC_KEY='ssh-ed25519 AAAA...' bash /tmp/bootstrap.sh"
#
# AFTER BOOTSTRAP:
#   ssh deploy@<ip> "docker --version && docker compose version"
#
# WHAT IT DOES:
#   - Installs Docker CE + compose plugin from Docker's official repo
#   - Creates the `deploy` user (docker + sudo group, passwordless sudo)
#   - Copies your SSH key to deploy@
#   - Creates /home/deploy/{prod,staging} directory structure
#   - Hardens sshd (password auth off, root SSH kept as key-only escape hatch)
#   - Configures ufw (only :22 open — Cloudflare Tunnel is outbound-only)
#   - Installs + enables fail2ban and unattended-upgrades
#   - Sets Docker daemon log rotation (10 MB × 3 files per container)
#
# WHAT IT DOES NOT DO:
#   - Deploy the render worker (that's `deploy.sh`, run after bootstrap)
#   - Create the .env file (that's `push-env.sh`)
#   - Open ports 80/443 — the tunnel makes only outbound connections

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PUBLIC_KEY="${DEPLOY_PUBLIC_KEY:-}"  # empty = fall back to root's authorized_keys

log()  { printf '\033[36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31mERR %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[ "$EUID" -eq 0 ] || die "must run as root (got uid $EUID)"
[ -f /etc/os-release ] || die "not an Ubuntu/Debian system"
. /etc/os-release
[ "$ID" = "ubuntu" ] || warn "expected ubuntu, got $ID — proceeding anyway"

CODENAME="${VERSION_CODENAME:-$(lsb_release -sc 2>/dev/null || echo unknown)}"
log "Ubuntu $VERSION_ID ($CODENAME) — $(uname -m)"

# ---------------------------------------------------------------------------
# APT base packages
# ---------------------------------------------------------------------------
log "installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release \
  ufw fail2ban unattended-upgrades \
  jq >/dev/null

# ---------------------------------------------------------------------------
# Docker CE + compose plugin (official repo)
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  log "installing Docker CE from download.docker.com"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH="$(dpkg --print-architecture)"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  # Docker's repo may not yet have a release for very recent Ubuntu codenames.
  # If the primary install fails, fall back to the previous LTS.
  if ! apt-get update -qq 2>/dev/null || \
     ! apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
       docker-compose-plugin docker-buildx-plugin 2>/dev/null; then
    warn "no Docker release for ${CODENAME} yet — falling back to noble"
    sed -i "s/ ${CODENAME} / noble /" /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
      docker-compose-plugin docker-buildx-plugin >/dev/null
  fi
else
  log "Docker already installed ($(docker --version))"
fi

# Verify compose plugin is usable
if ! docker compose version >/dev/null 2>&1; then
  log "installing docker-compose-plugin (missing)"
  apt-get install -y -qq docker-compose-plugin >/dev/null
fi

# ---------------------------------------------------------------------------
# Docker daemon: log rotation (prevent one runaway container filling disk)
# ---------------------------------------------------------------------------
mkdir -p /etc/docker
if ! grep -q 'max-size' /etc/docker/daemon.json 2>/dev/null; then
  log "configuring Docker log rotation"
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

# ---------------------------------------------------------------------------
# `deploy` user
# ---------------------------------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "creating user: $DEPLOY_USER"
  useradd -m -s /bin/bash -G docker,sudo "$DEPLOY_USER"
else
  log "user $DEPLOY_USER exists — ensuring docker group membership"
  usermod -aG docker,sudo "$DEPLOY_USER"
fi

# Passwordless sudo (CI needs it)
cat > /etc/sudoers.d/90-$DEPLOY_USER <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL
EOF
chmod 0440 /etc/sudoers.d/90-$DEPLOY_USER

# Home directory structure
sudo -u "$DEPLOY_USER" mkdir -p \
  "/home/$DEPLOY_USER/prod" \
  "/home/$DEPLOY_USER/staging" \
  "/home/$DEPLOY_USER/.ssh"

# ---------------------------------------------------------------------------
# SSH key for `deploy`
# ---------------------------------------------------------------------------
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
if [ -n "$DEPLOY_PUBLIC_KEY" ]; then
  log "installing DEPLOY_PUBLIC_KEY into $DEPLOY_USER's authorized_keys"
  # Preserve any keys that were already there (idempotent add)
  touch "$AUTH_KEYS"
  if ! grep -qF "$DEPLOY_PUBLIC_KEY" "$AUTH_KEYS"; then
    printf '%s\n' "$DEPLOY_PUBLIC_KEY" >> "$AUTH_KEYS"
  fi
elif [ -s /root/.ssh/authorized_keys ]; then
  log "no DEPLOY_PUBLIC_KEY provided — copying root's authorized_keys"
  cp /root/.ssh/authorized_keys "$AUTH_KEYS"
else
  warn "no SSH key configured for $DEPLOY_USER — you won't be able to SSH in as deploy"
  warn "re-run with DEPLOY_PUBLIC_KEY=\"ssh-ed25519 AAAA...\" bash bootstrap.sh"
fi

# Normalize (strip Windows CRLFs) and lock down perms
if [ -f "$AUTH_KEYS" ]; then
  sed -i 's/\r$//' "$AUTH_KEYS"
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  chmod 700 "/home/$DEPLOY_USER/.ssh"
  chmod 600 "$AUTH_KEYS"
fi

# ---------------------------------------------------------------------------
# sshd hardening (careful — we're using this connection right now)
# ---------------------------------------------------------------------------
log "hardening sshd (password auth off, root key-only)"
cat > /etc/ssh/sshd_config.d/10-repodcast.conf <<'CONF'
# Managed by worker/scripts/bootstrap.sh — do not edit by hand.
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF

# Validate BEFORE reloading — a broken config here would lock us out
if sshd -t; then
  systemctl reload ssh
else
  die "sshd config invalid — NOT reloading. Fix /etc/ssh/sshd_config.d/10-repodcast.conf"
fi

# ---------------------------------------------------------------------------
# fail2ban
# ---------------------------------------------------------------------------
log "configuring fail2ban for sshd"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

# ---------------------------------------------------------------------------
# ufw — only :22 open. Cloudflare Tunnel is outbound-only, so no :80/:443.
# ---------------------------------------------------------------------------
log "configuring ufw (SSH only)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null

# ---------------------------------------------------------------------------
# unattended security upgrades
# ---------------------------------------------------------------------------
log "enabling unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
systemctl enable --now unattended-upgrades >/dev/null

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
log "bootstrap complete"
echo "    Docker:  $(docker --version)"
echo "    Compose: $(docker compose version --short 2>/dev/null || echo '?')"
echo "    User:    $DEPLOY_USER (uid $(id -u "$DEPLOY_USER"), groups: $(id -Gn "$DEPLOY_USER" | tr ' ' ','))"
echo "    IP:      $(hostname -I | awk '{print $1}')"
echo
echo "Next:"
echo "    From your laptop:  ssh $DEPLOY_USER@$(hostname -I | awk '{print $1}') 'docker --version'"
echo "    Then deploy prod:  make -C worker deploy ENV=prod"
