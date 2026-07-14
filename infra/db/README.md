# Self-hosted Postgres

Runs Postgres 17 + PgBouncer + automated backups on the VPS, with offsite
copies to Cloudflare R2 and admin access gated behind Cloudflare Tunnel.

Same deploy pattern as `worker/`: one box, per-env compose project
(`repodcast-db-prod`, `repodcast-db-staging`), `push.ps1` from laptop.

## Layout on the box

```
/home/deploy/
  db-prod/
    docker-compose.yml
    .env                     (mode 600, deploy:deploy)
    postgres/postgresql.conf, pg_hba.conf
    certs/fullchain.pem, privkey.pem
    rclone/rclone.conf       (mode 600)
    backups/                 (named volume mount for local dumps)
    scripts/deploy.sh, restore-drill.sh
  db-staging/                (same shape)
```

## What connects where

| Client           | Endpoint                                  | Notes                                            |
| ---------------- | ----------------------------------------- | ------------------------------------------------ |
| Vercel app       | `db.repodcastapp.com:6432` (PgBouncer)    | `DATABASE_URL`, `sslmode=require&pgbouncer=true` |
| `prisma migrate` | `db.repodcastapp.com:6432` (PgBouncer)    | `DIRECT_URL`, `sslmode=require&pgbouncer=false`  |
| Laptop `psql`    | `localhost:5432` via `cloudflared access` | Zero Trust-gated TCP tunnel                      |

Vercel does **not** go through Cloudflare — it hits the public PgBouncer
port directly over TLS.

---

## First-time setup

### 1. VPS prep

Reuse the existing render-worker VPS (already has Docker + `deploy` user from
`worker/scripts/bootstrap.sh`). Open port 6432 in the firewall for Vercel:

```bash
ssh root@<vps-ip> "ufw allow 6432/tcp && ufw reload"
```

Port 5432 stays closed to the public — only cloudflared reaches it.

### 2. TLS certificate for PgBouncer

Point `db.repodcastapp.com` at the VPS (A record, **DNS only / grey cloud** —
Cloudflare's proxy won't forward Postgres protocol).

Create a Cloudflare API token: **dash.cloudflare.com → My Profile → API
Tokens → Create Custom Token**. Permissions: `Zone.Zone: Read` +
`Zone.DNS: Edit`. Zone Resources: `Include - repodcastapp.com`. Copy the
token into `.env.<env>` as `CLOUDFLARE_DNS_API_TOKEN`.

That's it — cert issuance and renewal live entirely on the VPS via
`scripts/renew.sh`, which runs lego in a container against Cloudflare DNS-01.

- **First deploy:** `deploy.sh` detects no cert on disk and calls
  `renew.sh` to issue one before starting the stack.
- **Ongoing renewal:** `deploy.sh` installs a cron entry at 03:15 daily.
  `renew.sh` no-ops until the cert is within 30 days of expiry, then
  renews, reloads Postgres SSL config (`pg_reload_conf`), and restarts
  PgBouncer to pick up the new cert.

Nothing to install on your laptop. Logs land in `~/db-<env>/renew.log` on
the box.

Trigger a manual check any time:

```powershell
ssh deploy@$env:DB_HOST "~/db-prod/scripts/renew.sh prod"
```

Inspect the installed cron entry:

```powershell
ssh deploy@$env:DB_HOST "crontab -l | grep repodcast-db-renew"
```

### 3. Cloudflare Tunnel for admin access

Gates raw TCP `psql` access to Postgres behind Cloudflare Access, so only
your authenticated account can connect. Vercel doesn't use this path — it
hits PgBouncer publicly on 6432.

Same pattern as the render worker tunnels in `../Setup.md` §2, but with a
**TCP** hostname instead of HTTP.

#### 3.1 Create the tunnel

**one.dash.cloudflare.com** (Zero Trust) → **Networks → Tunnels → Create a tunnel**:

| Field       | Value                                           |
| ----------- | ----------------------------------------------- |
| Connector   | `Cloudflared`                                   |
| Tunnel name | `repodcast-db-prod` (or `repodcast-db-staging`) |

Save → **copy the token** (long `eyJhIjoi...` string after `--token`) →
paste it into `.env.<env>` as `CLOUDFLARE_TUNNEL_TOKEN`. Ignore the docker
install command Cloudflare shows — the compose stack runs cloudflared for
you.

#### 3.2 Configure the Public Hostname (TCP)

Next screen (or **Configure → Public Hostname → Add a public hostname**):

| Field     | Value                                            |
| --------- | ------------------------------------------------ |
| Subdomain | `db-admin` (prod) / `db-admin-staging` (staging) |
| Domain    | `repodcastapp.com`                               |
| Path      | _(leave blank)_                                  |
| Type      | **TCP**                                          |
| URL       | `postgres:5432`                                  |

The `postgres` in the URL is the compose service name — cloudflared runs
on the same compose network so it resolves via Docker DNS. Save. Cloudflare
auto-creates `db-admin.repodcastapp.com` as a Proxied CNAME.

#### 3.3 Gate with Cloudflare Access (required)

Without an Access application, anyone could probe the hostname. Zero Trust →
**Access → Applications → Add an application → Self-hosted**:

| Field              | Value                       |
| ------------------ | --------------------------- |
| Application name   | `RePodCast DB admin (prod)` |
| Session Duration   | 24 hours                    |
| Application domain | `db-admin.repodcastapp.com` |

Add a policy:

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Policy name | `Owners`                                                    |
| Action      | Allow                                                       |
| Rule        | Include → _Emails_ → `contact@repodcastapp.com` (or others) |

Repeat for staging.

#### 3.4 Connect from your laptop

Install cloudflared once: **[developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)**
(Windows: `.msi` installer). Then in one PowerShell tab:

```powershell
cloudflared access tcp --hostname db-admin.repodcastapp.com --url localhost:15432
```

First run opens a browser for Cloudflare Access login; subsequent runs use
the cached identity token. The local port `15432` avoids Windows' reserved
port range (Hyper-V / WSL2 / Docker Desktop often exclude 5432 — you'd get
`WSAEACCES` if you tried to bind it). In a second tab:

```powershell
psql "postgresql://repodcast@localhost:15432/repodcast?sslmode=require"
```

`sslmode=require` (not `verify-full`) — you're connecting to `localhost` so
the cert's hostname won't match, but the tunnel already provides encryption
end-to-end. `require` still forces TLS on the Postgres wire.

### 4. Local config files

```powershell
cd infra\db
copy .env.example .env.prod
copy .env.example .env.staging
copy rclone\rclone.conf.example rclone\rclone.conf.prod
copy rclone\rclone.conf.example rclone\rclone.conf.staging
```

Fill in each. Generate passwords: `openssl rand -base64 48`.

### 5. Deploy

```powershell
$env:DB_HOST = "<vps-ip>"    # or reuse $env:WORKER_HOST if same box
.\infra\db\scripts\push.ps1 prod
.\infra\db\scripts\push.ps1 staging
```

### 6. Schema migrations

`push.ps1` runs `prisma migrate deploy` automatically after the stack is up
— it builds `DATABASE_URL` and `DIRECT_URL` from `.env.<env>` (URL-encoding
the password) and applies pending migrations against PgBouncer.

To push infra changes only, without touching the DB schema:

```powershell
.\infra\db\scripts\push.ps1 staging -SkipMigrate
```

For the app deploy on Vercel, use the same URL shape:

```
DATABASE_URL = postgresql://repodcast:<url-encoded-pw>@db.repodcastapp.com:6432/repodcast?sslmode=require&pgbouncer=true
DIRECT_URL   = postgresql://repodcast:<url-encoded-pw>@db.repodcastapp.com:6432/repodcast?sslmode=require&pgbouncer=false
```

`DIRECT_URL` uses `?pgbouncer=false` so Prisma opens a session-level
connection — required for DDL (`migrate deploy`, `db push`).

---

## Ops

```powershell
# Live logs
ssh deploy@$env:DB_HOST "docker compose --env-file ~/db-prod/.env -p repodcast-db-prod logs -f --tail=200"

# psql (via cloudflared)
cloudflared access tcp --hostname db-admin.repodcastapp.com --url localhost:15432
psql "postgresql://repodcast@localhost:15432/repodcast?sslmode=require"

# On-demand backup
ssh deploy@$env:DB_HOST "docker compose --env-file ~/db-prod/.env -p repodcast-db-prod exec backup /backup.sh"

# List local backups
ssh deploy@$env:DB_HOST "ls -lh ~/db-prod/backups/daily/ | tail -5"

# List offsite backups
rclone ls r2:repodcast-db-backups-prod --config infra/db/rclone/rclone.conf.prod | tail -20
```

## Backup contract

- **Daily** local dumps at 03:00 UTC, kept 7 days.
- **Weekly** rollups kept 4 weeks.
- **Monthly** rollups kept 6 months.
- **Offsite** to Cloudflare R2 every hour.
- **Restore drill** monthly via `scripts/restore-drill.sh` — schedule via cron:
  ```bash
  ssh deploy@$env:DB_HOST "crontab -l | { cat; echo '0 5 1 * * /home/deploy/db-prod/scripts/restore-drill.sh prod >> /home/deploy/restore-drill.log 2>&1'; } | crontab -"
  ```

Untested backups aren't backups. The drill script exits non-zero if the
restored DB has fewer than 10 tables — hook it into your monitoring.

## Rotation and recovery

- **Rotating `POSTGRES_PASSWORD`:** run `ALTER ROLE repodcast WITH PASSWORD '<new>'` via psql → update `.env.prod` → `push.ps1 prod` → update Vercel `DATABASE_URL` / `DIRECT_URL` → redeploy.
- **Rotating TLS cert:** `ssh deploy@$env:DB_HOST "~/db-prod/scripts/renew.sh prod"` — force-renew ignores the 30-day threshold if you pass `RENEW_WITHIN_DAYS=999 renew.sh prod` (useful during compromise recovery). Otherwise nothing to do; cron handles it.
- **Rotating tunnel token:** Zero Trust dashboard → tunnel → **Refresh Token** → save new value in `.env.<env>` → `push.ps1 <env>`.
- **Full VPS rebuild:** provision box → `worker/scripts/bootstrap.sh` → `push.ps1 prod` → restore newest offsite dump via `scripts/restore-drill.sh` logic (adapt to write into the real container, not a drill one) → update DNS if new IP → smoke test.
