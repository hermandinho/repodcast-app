# Infrastructure Setup

> Reproducible steps to bring up (or recover) the render-worker infrastructure.
> Covers everything after the VPS is bootstrapped by `worker/scripts/bootstrap.sh`.
>
> Read this alongside:
>
> - `Q1.md` — Q1 roadmap and rationale
> - `worker/README.md` — day-to-day deploy commands
> - `worker/scripts/bootstrap.sh` — first-run VPS setup (before this doc)

---

## Assumptions before you start

- Domain `repodcastapp.com` is registered (currently at Hostinger).
- A Vercel project is deployed against the domain (production + staging).
- A Cloudflare account exists (Free plan is fine).
- The VPS has already been provisioned and `bootstrap.sh` has run
  successfully — `docker compose version` works, `deploy@` user exists.
- You have the VPS IP handy (set `$env:WORKER_HOST` in PowerShell before running any `push.ps1` command).

---

## 1. Cloudflare DNS migration

Move authoritative DNS from Hostinger's nameservers to Cloudflare's so
Tunnel + Workers AI + future edge features can plug in.

### 1.1 Add site to Cloudflare

- **dash.cloudflare.com** → **Add a Site** → `repodcastapp.com` → Continue → **Free** plan.
- On the "Review your DNS records" screen, Cloudflare auto-imports records from Hostinger.

### 1.2 Inventory current records at Hostinger

Before flipping nameservers, list every record at **hpanel.hostinger.com** → **Domains → repodcastapp.com → DNS**. Screenshot or export. Pay attention to:

- Apex `A` record (points at Vercel: `216.198.79.1`).
- `www` and `staging` CNAMEs (point at Vercel: `*.vercel-dns-017.com`).
- Clerk CNAMEs: `accounts`, `clerk`, `clkmail`, `clk._domainkey`, `clk2._domainkey`.
- Hostinger DKIM CNAMEs: `hostingermail-a/b/c._domainkey`.
- Resend DKIM TXT: `resend._domainkey` (long `p=...` blob — verify it wasn't truncated during import).
- SPF TXT (apex): `v=spf1 include:_spf.mail.hostinger.com ~all`.
- DMARC TXT (`_dmarc`).
- MX records to `mx1/mx2.hostinger.com`.
- `send` subdomain MX + SPF (Amazon SES for Resend).

Cross-check the CF-imported list against this inventory. Manually add any missing record before proceeding.

### 1.3 Fix proxy status — critical

**All records pointing at third-party HTTPS services MUST be `DNS only` (grey cloud), not `Proxied` (orange cloud).** Proxying a CNAME that already terminates its own TLS (Vercel, Clerk, etc.) causes 525/526 handshake errors.

Records that must be grey:

| Record                                    | Reason                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| Apex `A repodcastapp.com` (Vercel)        | Vercel has its own edge + TLS                        |
| `www` CNAME → Vercel                      | Same                                                 |
| `staging` CNAME → Vercel                  | Same                                                 |
| `accounts` CNAME → Clerk                  | Clerk edge                                           |
| `clerk` CNAME → Clerk                     | Same                                                 |
| `clkmail` CNAME → Clerk                   | Same                                                 |
| `clk._domainkey` CNAME → Clerk            | DKIM verification needs the raw CNAME target visible |
| `clk2._domainkey` CNAME → Clerk           | Same                                                 |
| `autoconfig` / `autodiscover` → Hostinger | Email autoconfig                                     |
| `hostingermail-a/b/c._domainkey`          | DKIM (same reason as Clerk DKIMs)                    |

Records that stay orange:

| Record                                | Reason                            |
| ------------------------------------- | --------------------------------- |
| `render` → cloudflared tunnel         | Cloudflare's edge IS the endpoint |
| `render-staging` → cloudflared tunnel | Same                              |

### 1.4 Flip nameservers at Hostinger

- **hpanel.hostinger.com** → **Domains → repodcastapp.com → Nameservers → Change nameservers → Use custom nameservers**.
- Paste the two Cloudflare nameservers from the CF "Continue to activation" screen.
- Save.

Propagation: 5–30 min typical. Cloudflare emails "your site is active."

### 1.5 Verify

```powershell
curl.exe -sI https://repodcastapp.com | Select-String -Pattern 'server|x-vercel'
Resolve-DnsName accounts.repodcastapp.com -Type CNAME -Server 1.1.1.1
```

- Header row should say `server: Vercel` (not `cloudflare`).
- Clerk CNAMEs should resolve to targets ending in `.clerk.services`.

Manual smoke test in incognito:

- Load `https://repodcastapp.com` — Vercel app renders.
- Sign in — Clerk flow works.
- Trigger any email — Resend delivers.

If Clerk's dashboard shows "could not determine the current DNS value," that means at least one Clerk record is still orange-clouded. Fix per §1.3.

---

## 2. Cloudflare Tunnels — one per environment

Two independent tunnels give us real isolation between prod and staging.
Both run as `cloudflared` containers on the same VPS.

### 2.1 Prod tunnel

- **one.dash.cloudflare.com** (Zero Trust — different dashboard from the main dash).
- First-time setup: team name `repodcast`, Free plan.
- **Networks → Tunnels → Create a tunnel**.
- Connector: **Cloudflared** → Next.
- Name: `repodcast-worker` → Save.
- **Copy the token** from the install screen (long `eyJhIjoi...` string after `--token`). Save as `CLOUDFLARE_TUNNEL_TOKEN` in the prod env vault (1Password, gopass, etc.). Ignore the docker install command — we run cloudflared ourselves in compose.
- Next → **Public Hostname**:

  | Field     | Value              |
  | --------- | ------------------ |
  | Subdomain | `render`           |
  | Domain    | `repodcastapp.com` |
  | Path      | (blank)            |
  | Type      | `HTTP`             |
  | URL       | `render:8080`      |

- Save. Cloudflare auto-creates `render.repodcastapp.com` as a Proxied CNAME.

### 2.2 Staging tunnel

Same steps, different names:

- Tunnel name: `repodcast-worker-staging`.
- Token saved as `CLOUDFLARE_TUNNEL_TOKEN_STAGING`.
- Public Hostname: subdomain `render-staging`, same domain + type + URL.

Both tunnels show **Inactive** until cloudflared containers connect from the VPS.

### 2.3 Verify DNS records exist

**dash.cloudflare.com** → `repodcastapp.com` → **DNS → Records**. Confirm two orange-clouded CNAMEs:

- `render` → `<uuid>.cfargotunnel.com`
- `render-staging` → `<different-uuid>.cfargotunnel.com`

If missing: delete the Public Hostname in the tunnel config and re-add.

---

## 3. Cloudflare Workers AI token

For AI episode artwork (Q1 feature #4).

- **dash.cloudflare.com** → avatar (top-right) → **My Profile → API Tokens → Create Token → Create Custom Token**.
- Name: `repodcast-workers-ai`.
- Permissions: one row — `Account` / `Workers AI` / `Read`.
- Account Resources: `Include` → your account.
- TTL: blank (never expires).
- **Continue to summary → Create Token**.
- Copy the token — **one-time view**. Save as `CLOUDFLARE_WORKERS_AI_TOKEN`.

Also grab **Account ID** from the right sidebar of `dash.cloudflare.com → Workers & Pages`. 32 hex chars. Save as `CLOUDFLARE_ACCOUNT_ID` (if not already present from R2 setup).

---

## 4. Worker env files

Populate on your laptop only — never commit these files.

```powershell
cp worker\.env.example worker\.env.prod
cp worker\.env.example worker\.env.staging
```

Fill in each:

| Var                       | Where it comes from                                        |
| ------------------------- | ---------------------------------------------------------- |
| `WORKER_ENV`              | Literal `prod` or `staging`                                |
| `IMAGE_TAG`               | `local` (until we set up CI)                               |
| `WORKER_SHARED_SECRET`    | `openssl rand -hex 32` — generate a different one per env  |
| `CLOUDFLARE_TUNNEL_TOKEN` | From §2.1 (prod) or §2.2 (staging) — different per env     |
| `R2_ACCOUNT_ID`           | Reuse from Next.js `.env.local`                            |
| `R2_ACCESS_KEY_ID`        | Same                                                       |
| `R2_SECRET_ACCESS_KEY`    | Same                                                       |
| `R2_BUCKET`               | Same                                                       |
| `SENTRY_DSN`              | Blank for now; new `repodcast-worker` Sentry project later |

Both files are excluded from git by the root `.gitignore` pattern `.env*`.

---

## 5. First deploy

Set `WORKER_HOST` in your shell, then push each env:

```powershell
$env:WORKER_HOST = "<vps-ip>"

cd worker
npm install                # generates package-lock.json (first time only)
cd ..

./worker/scripts/push.ps1 staging
./worker/scripts/push.ps1 prod
```

Each push scp's code + `.env.<env>` to `deploy@<host>:~/<env>/`, then runs `deploy.sh <env>` on the box which does `docker compose up -d --build`. First build takes ~90 s; subsequent builds ~15 s.

---

## 6. Verify

```powershell
curl.exe https://render.repodcastapp.com/healthz
curl.exe https://render-staging.repodcastapp.com/healthz
```

Both should return `{"ok":true,"env":"<env>","uptime":...,"version":"local"}`.

In **one.dash.cloudflare.com → Networks → Tunnels**, both tunnels should show **Active** with one connector each.

---

## Rotation and recovery

- **Rotating `WORKER_SHARED_SECRET`:** update `.env.<env>` on laptop → `./worker/scripts/push.ps1 <env>` → also update the same var in Vercel env and redeploy the Next.js app.
- **Rotating tunnel token:** Zero Trust dashboard → tunnel → **Refresh Token** → save new value in `.env.<env>` → `push.ps1 <env>`.
- **Rotating Workers AI token:** create new token in CF dashboard → update Vercel env → redeploy app → revoke the old token.
- **Full VPS rebuild:** provision a fresh box → run `bootstrap.sh` → `push.ps1 prod` + `push.ps1 staging` → update tunnel DNS if new IP → healthz should return 200 within ~5 min total.
- **Nameserver rollback:** at Hostinger DNS panel, change nameservers back to `aster.dns-parking.com` + `helios.dns-parking.com`. Vercel/Clerk/email continue serving off Hostinger's DNS during and after the rollback (record parity preserved from §1.2 inventory).

---

## What lives where — quick reference

| Layer                                               | Storage                                     | Rotated by           |
| --------------------------------------------------- | ------------------------------------------- | -------------------- |
| Vercel env (Next.js)                                | Vercel dashboard                            | Vercel UI            |
| Worker env (`~/prod/.env`, `~/staging/.env` on VPS) | `.env.prod` / `.env.staging` on your laptop | `push.ps1`           |
| Terraform state                                     | None (no Terraform)                         | —                    |
| Docker images                                       | Built on the box from source                | Every `push.ps1`     |
| Cloudflare tokens                                   | Password manager                            | CF dashboard         |
| DNS records                                         | Cloudflare                                  | CF dashboard         |
| Tunnel routes                                       | Cloudflare Zero Trust                       | Zero Trust dashboard |
