# Repodcast render worker

Runs on a VPS behind Cloudflare Tunnel. Two envs (prod, staging) share one
box, isolated by docker-compose project name + separate tunnels.

## First-time setup (one-off)

```powershell
# Provision the box (installs Docker, creates deploy user, hardens sshd)
scp scripts/bootstrap.sh root@<ip>:/tmp/
ssh root@<ip> "bash /tmp/bootstrap.sh"

# Set WORKER_HOST in your shell so the push scripts know the box
$env:WORKER_HOST = "<ip>"

# Fill in .env.prod and .env.staging from .env.example (do this on your laptop, never commit)
copy .env.example .env.prod
copy .env.example .env.staging
```

## Deploy

```powershell
# Push code + env, build, up -d
./scripts/push.ps1 prod
./scripts/push.ps1 staging
```

## Verify

```powershell
curl https://render.repodcastapp.com/healthz
curl https://render-staging.repodcastapp.com/healthz
```

Both should return `{"ok":true,"env":"prod","uptime":...,"version":"local"}`.

## Ops

```powershell
# Logs (live tail)
ssh deploy@$env:WORKER_HOST "docker compose --env-file ~/prod/.env -p repodcast-prod logs -f --tail=200"

# Restart without redeploy
ssh deploy@$env:WORKER_HOST "docker compose --env-file ~/prod/.env -p repodcast-prod restart"

# Rebuild from scratch
./scripts/push.ps1 prod
```

## Structure on the box

```
/home/deploy/
  prod/
    Dockerfile, docker-compose.yml, package.json, tsconfig.json, src/, scripts/
    .env                     (mode 600, deploy:deploy)
  staging/
    (same shape)
```

Each env is its own docker-compose project: `repodcast-prod` and
`repodcast-staging`. Isolated networks, isolated volumes, isolated
cloudflared tunnels.

## What's NOT here yet (planned for Q1 weeks 3–10)

- ffmpeg + fonts in the Dockerfile (add when building clip generation)
- `POST /render/clip` implementation
- `POST /render/audiogram` implementation
- ytdl-core for YouTube source download
- R2 upload wiring
- Sentry `@sentry/node` init

Currently `/healthz` is the only functional endpoint. Everything else
returns 501.
