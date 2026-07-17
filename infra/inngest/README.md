# Self-hosted Inngest

Runs the Inngest OSS server (SQLite + embedded queue) on the VPS to replace
the Inngest Cloud production app. Staging continues to use Inngest Cloud —
this stack is prod-only.

Same deploy pattern as `worker/` and `infra/db/`: one box, per-env compose
project (`repodcast-inngest-prod`), `push.ps1` from laptop.

## Why this exists

Cloud free tier caps at 50k executions/month. Solo pre-launch traffic
already sits around 18k, so a real client cohort will bust the ceiling.
Self-hosting on the box we already pay for keeps the bill flat.

## Why SQLite (not Postgres+Redis)

Inngest's `inngest start` binary ships both drivers. SQLite mode is the
default and includes an in-memory queue, so the whole stack is one
container plus a volume — no extra Postgres schema, no extra Redis
service. Fine for single-node deployments; the source-of-truth on this
tradeoff is Inngest's [self-host docs](https://www.inngest.com/docs/self-hosting).

Migration path if we outgrow it: point `INNGEST_POSTGRES_URI` at a new
DB on the existing pg container, `INNGEST_REDIS_URI` at a new Redis
service in this same compose, one-time SQLite → Postgres export. No
Vercel-side changes.

## Layout on the box

```
/home/deploy/
  inngest-prod/
    docker-compose.yml
    .env                     (mode 600, deploy:deploy)
    rclone/rclone.conf       (mode 600)
    backups/                 (hourly SQLite snapshots, 7-day rolling)
    scripts/deploy.sh
```

Docker-managed named volume `inngest_data` holds the live `main.db`,
WAL, and SHM.

## What connects where

| Client            | Endpoint                               | Edge auth                                  |
| ----------------- | -------------------------------------- | ------------------------------------------ |
| Vercel prod (SDK) | `https://inngest.repodcastapp.com/...` | Access **Service Auth** (CF Service Token) |
| Dashboard (you)   | `https://inngest.repodcastapp.com/`    | Access **Allow** with SSO                  |
| Inngest → Vercel  | `https://repodcastapp.com/api/inngest` | Signing key (SDK verifies in `serve()`)    |

**One** hostname, **one** tunnel, **one** Cloudflare Access application
covering `inngest.repodcastapp.com/*` with **two policies**:

| Policy       | Action           | Rule                                              |
| ------------ | ---------------- | ------------------------------------------------- |
| `SDK access` | **Service Auth** | Include → Service Token → `repodcast-inngest-sdk` |
| `Owners`     | Allow            | Include → Emails → `contact@repodcastapp.com`     |

Access evaluates Service Auth policies before Allow, so the SDK's requests
pass through on the strength of a token header pair — every path is
covered without enumerating Inngest's API surface.

**Why not path-scoped Bypass on `/e/*`?** The SDK also hits `/fn/register`
(and future endpoints Inngest may add). Any path-based rule would leave
non-`/e/*` calls to hit the SSO Allow policy, which serves HTML and
crashes the SDK's `JSON.parse` at `InngestCommHandler.register()`.
Service Auth avoids the path-enumeration trap entirely.

**Why not skip Access on the whole hostname?** Then the dashboard — which
Inngest OSS ships without built-in auth — is public to anyone who
guesses the subdomain.

---

## First-time setup

### 1. Cloudflare Tunnel

**one.dash.cloudflare.com** (Zero Trust) → **Networks → Tunnels → Create a tunnel**:

| Field       | Value               |
| ----------- | ------------------- |
| Connector   | `Cloudflared`       |
| Tunnel name | `repodcast-inngest` |

Save → copy the token (long `eyJhIjoi...` string) → paste it into
`.env.prod` as `CLOUDFLARE_TUNNEL_TOKEN`. Ignore the docker install
command Cloudflare shows — compose runs cloudflared for us.

Add **one** Public Hostname on the tunnel:

| Field     | Value              |
| --------- | ------------------ |
| Subdomain | `inngest`          |
| Domain    | `repodcastapp.com` |
| Path      | _(blank)_          |
| Type      | `HTTP`             |
| URL       | `inngest:8288`     |

Cloudflare auto-creates `inngest.repodcastapp.com` as a Proxied CNAME.

### 2. Cloudflare Access — one app, two policies

#### 2.1 Create the Service Token (for the SDK)

Zero Trust → **Access → Service Auth → Service Tokens → Create Service Token**:

| Field                  | Value                            |
| ---------------------- | -------------------------------- |
| Service Token Name     | `repodcast-inngest-sdk`          |
| Service Token Duration | `Non-expiring` (rotate manually) |

Copy both values on the reveal screen — Cloudflare only shows the Client
Secret once:

- `CF_ACCESS_CLIENT_ID` → paste into Vercel prod env (§6) as
  `CF_ACCESS_CLIENT_ID`.
- `CF_ACCESS_CLIENT_SECRET` → paste into Vercel prod env as
  `CF_ACCESS_CLIENT_SECRET`.

#### 2.2 Create the Access application

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

| Field              | Value                                |
| ------------------ | ------------------------------------ |
| Application name   | `RePodCast Inngest`                  |
| Session Duration   | 24 hours                             |
| Application domain | `inngest.repodcastapp.com`           |
| Path               | _(blank — cover the whole hostname)_ |

Add **two** policies on this same application. Order matters only when
both would match — Service Auth wins over Allow, so requests with the
service-token headers get through without ever touching SSO.

**Policy A — SDK access (Service Auth):**

| Field       | Value                                                 |
| ----------- | ----------------------------------------------------- |
| Policy name | `SDK access`                                          |
| Action      | **Service Auth**                                      |
| Rule        | Include → **Service Token** → `repodcast-inngest-sdk` |

**Policy B — dashboard (SSO):**

| Field       | Value                                         |
| ----------- | --------------------------------------------- |
| Policy name | `Owners`                                      |
| Action      | Allow                                         |
| Rule        | Include → Emails → `contact@repodcastapp.com` |

Verify after both are configured:

```bash
# Without headers: HTML SSO redirect (good — dashboard is protected)
curl -I https://inngest.repodcastapp.com/
# 302 Location: https://<team>.cloudflareaccess.com/...

# With service token: reaches origin (good — SDK path works)
curl -I https://inngest.repodcastapp.com/fn/register \
  -H "CF-Access-Client-Id: <id>" \
  -H "CF-Access-Client-Secret: <secret>"
# Response from Inngest (401/405, not an SSO page)
```

### 3. R2 bucket for offsite backups

**dash.cloudflare.com → R2 → Create bucket**:

- Name: `repodcast-inngest-backups-prod`
- Location: same region as the DB backup bucket
- Access: private

Reuse the existing R2 API token (the one already in
`infra/db/rclone/rclone.conf.prod` will work here too — R2 tokens are
account-scoped, not bucket-scoped).

### 4. Local config

```powershell
cd infra\inngest
copy .env.example .env.prod
copy rclone\rclone.conf.example rclone\rclone.conf.prod
```

Fill in:

- `CLOUDFLARE_TUNNEL_TOKEN` from step 1.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` — generate each with
  `openssl rand -hex 32`. Signing key must be even-length hex.
- `rclone.conf.prod` — R2 access key + secret + endpoint (mirror the DB
  stack's file).

### 5. Deploy

```powershell
$env:INNGEST_HOST = "<vps-ip>"   # or reuse $env:WORKER_HOST
.\infra\inngest\scripts\push.ps1
```

First deploy pulls the `inngest/inngest:v1.37.0` image (~50 MB). Should
be up in ~30 seconds. Verify:

```powershell
curl.exe -I https://inngest.repodcastapp.com/
ssh deploy@$env:INNGEST_HOST "docker compose --env-file ~/inngest-prod/.env -p repodcast-inngest-prod ps"
```

In `one.dash.cloudflare.com → Networks → Tunnels`, `repodcast-inngest`
should show **Active** with one connector.

### 6. Wire Vercel prod

In the Vercel dashboard → RePodCast → Settings → Environment Variables →
Production:

| Var                       | Value                                   |
| ------------------------- | --------------------------------------- |
| `INNGEST_BASE_URL`        | `https://inngest.repodcastapp.com`      |
| `INNGEST_EVENT_KEY`       | (same hex as in `.env.prod`)            |
| `INNGEST_SIGNING_KEY`     | (same hex as in `.env.prod`)            |
| `CF_ACCESS_CLIENT_ID`     | from §2.1 (Service Token reveal screen) |
| `CF_ACCESS_CLIENT_SECRET` | from §2.1 (Service Token reveal screen) |
| `INNGEST_DEV`             | remove / leave unset                    |

Preview + Development stay on Inngest Cloud — don't touch those envs.
Redeploy prod.

### 7. Sync the app

Open `https://inngest.repodcastapp.com/` (Access will bounce you through
SSO the first time — that's app 2.2 doing its job) → **Apps → Sync new
app** → paste `https://repodcastapp.com/api/inngest` → **Sync**.

All 17 functions from `inngest/functions.ts` should register. Trigger a
smoke test via **Send event → `test/hello`** and confirm the `helloFn`
run lands in the Runs view.

---

## Cutover from Inngest Cloud (prod)

Because there are no prod clients yet, this is a no-drain flip:

1. Deploy the self-hosted stack (steps 1–5 above).
2. Set the four Vercel prod env vars (step 6).
3. Redeploy Vercel prod.
4. Sync the app in the self-hosted dashboard (step 7).
5. Fire one real event end-to-end (e.g. an RSS import) — confirm the run
   appears + finishes cleanly.
6. Leave the Cloud prod app running (untouched) for 48h as a rollback
   parachute. If nothing breaks, delete it from the Inngest Cloud
   dashboard.

**Rollback** is symmetric: unset `INNGEST_BASE_URL` in Vercel prod →
redeploy → SDK falls back to Inngest Cloud → re-sync the Cloud app.

---

## Ops

```powershell
# Live logs
ssh deploy@$env:INNGEST_HOST "docker compose --env-file ~/inngest-prod/.env -p repodcast-inngest-prod logs -f --tail=200"

# Just the inngest container
ssh deploy@$env:INNGEST_HOST "docker logs -f --tail=200 repodcast-inngest-prod-inngest-1"

# List local backups
ssh deploy@$env:INNGEST_HOST "ls -lh ~/inngest-prod/backups/ | tail -10"

# List offsite backups
rclone ls r2:repodcast-inngest-backups-prod --config infra/inngest/rclone/rclone.conf.prod | tail -10

# Force an out-of-band snapshot (writes into the shared backups volume)
ssh deploy@$env:INNGEST_HOST "docker exec repodcast-inngest-prod-sqlite_backup-1 sqlite3 /data/main.db \".backup /backups/main-manual-$(date -u +%Y%m%d-%H%M%S).db\""

# Restart just the inngest process (SQLite is durable — restart is safe)
ssh deploy@$env:INNGEST_HOST "docker compose --env-file ~/inngest-prod/.env -p repodcast-inngest-prod restart inngest"
```

## Backup contract

- **Hourly** SQLite `.backup` snapshot on the box.
- **7-day** local retention (168 hourly snapshots).
- **Hourly** offsite mirror to `r2:repodcast-inngest-backups-prod` via
  `rclone sync` — R2 tracks the local set exactly.
- **No** automated restore drill yet. Do a manual one after the first
  month:
  ```bash
  ssh deploy@$env:INNGEST_HOST
  cd /tmp && mkdir restore-drill && cd restore-drill
  rclone copy r2:repodcast-inngest-backups-prod/<newest>.db . \
    --config ~/inngest-prod/rclone/rclone.conf
  sqlite3 <newest>.db "SELECT COUNT(*) FROM function_runs;"
  ```
  Should return a non-zero row count.

## Rotation and recovery

- **Rotating `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`:** update
  `.env.prod` → `push.ps1` → update the same vars in Vercel prod →
  redeploy. During the window between VPS restart and Vercel redeploy,
  the SDK will 401 against the new server — keep both changes tight.
- **Rotating tunnel token:** Zero Trust dashboard → tunnel → **Refresh
  Token** → save new value in `.env.prod` → `push.ps1`.
- **Rotating the CF Access Service Token:** Zero Trust → Access → Service
  Auth → `repodcast-inngest-sdk` → **Refresh** → update
  `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` in Vercel prod →
  redeploy. Cloudflare keeps the old token valid for a short overlap
  window, so you don't have to sequence this atomically.
- **Full VPS rebuild:** provision box → run `worker/scripts/bootstrap.sh`
  → `push.ps1` (this stack) + `infra/db/scripts/push.ps1 prod` +
  `worker/scripts/push.ps1 prod` → restore newest offsite Inngest DB into
  the fresh `inngest_data` volume (`docker cp <db> repodcast-inngest-prod-inngest-1:/data/main.db`
  before first start, or run inside `docker run --rm -v inngest_data:/data alpine cp ...`).
  In-flight runs from before the rebuild are lost — the SDK will not
  retransmit events, so treat this as a hard reset.

## When to migrate off SQLite

Watch for any of:

- Sustained > 100k executions/month.
- P95 event-ingest latency > 200ms (check the dashboard's Metrics tab).
- `sqlite3 .backup` snapshots pushing over ~500 MB (WAL bloat).

At that point: stand up a second Postgres DB on `infra/db`
(`inngest_prod` alongside `repodcast`), add a Redis service to this
compose, set `INNGEST_POSTGRES_URI` + `INNGEST_REDIS_URI` in `.env.prod`,
one-time export SQLite state (Inngest publishes a migration tool), and
redeploy. The SDK side doesn't change.
