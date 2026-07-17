# Push Inngest stack + env to the VPS, run deploy.sh.
#
# Prod-only — staging still uses Inngest Cloud, so this script takes no env arg.
#
# Usage (from any directory):
#   $env:INNGEST_HOST = "15.204.114.174"   # or reuse $env:WORKER_HOST
#   ./infra/inngest/scripts/push.ps1

$ErrorActionPreference = 'Stop'

# infra/inngest/ absolute path — script lives at infra/inngest/scripts/push.ps1
$InngestDir = Split-Path -Parent $PSScriptRoot

$TargetHost = $env:INNGEST_HOST
if (-not $TargetHost) { $TargetHost = $env:WORKER_HOST }
if (-not $TargetHost) {
    Write-Error "Neither INNGEST_HOST nor WORKER_HOST is set. Run: `$env:INNGEST_HOST = '<vps-ip>'"
    exit 1
}

$EnvFile   = Join-Path $InngestDir '.env.prod'
$RcloneCfg = Join-Path $InngestDir 'rclone/rclone.conf.prod'

if (-not (Test-Path $EnvFile))   { Write-Error "Missing $EnvFile. Copy .env.example -> .env.prod and fill it in."; exit 1 }
if (-not (Test-Path $RcloneCfg)) { Write-Error "Missing $RcloneCfg. Copy rclone/rclone.conf.example -> rclone/rclone.conf.prod and fill it in."; exit 1 }

$Remote     = "deploy@${TargetHost}"
$RemoteRoot = '~/inngest-prod'

Write-Host "==> preparing target dirs on $TargetHost" -ForegroundColor Cyan
& ssh $Remote "mkdir -p $RemoteRoot/scripts $RemoteRoot/rclone $RemoteRoot/backups"

Write-Host "==> pushing docker-compose.yml" -ForegroundColor Cyan
& scp (Join-Path $InngestDir 'docker-compose.yml') "${Remote}:${RemoteRoot}/"

Write-Host "==> pushing rclone.conf.prod -> rclone/rclone.conf" -ForegroundColor Cyan
& scp $RcloneCfg "${Remote}:${RemoteRoot}/rclone/rclone.conf"
& ssh $Remote "chmod 600 $RemoteRoot/rclone/rclone.conf"

Write-Host "==> pushing scripts/deploy.sh" -ForegroundColor Cyan
& scp (Join-Path $InngestDir 'scripts/deploy.sh') "${Remote}:${RemoteRoot}/scripts/"
& ssh $Remote "chmod +x $RemoteRoot/scripts/*.sh"

Write-Host "==> pushing .env.prod -> .env" -ForegroundColor Cyan
& scp $EnvFile "${Remote}:${RemoteRoot}/.env"
& ssh $Remote "chmod 600 $RemoteRoot/.env"

Write-Host "==> deploying" -ForegroundColor Cyan
& ssh $Remote "bash $RemoteRoot/scripts/deploy.sh"
if ($LASTEXITCODE -ne 0) { Write-Error "deploy.sh exited $LASTEXITCODE"; exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> done. verify:" -ForegroundColor Green
Write-Host "    curl.exe -I https://inngest.repodcastapp.com/"
Write-Host "    ssh $Remote 'docker compose --env-file ~/inngest-prod/.env -p repodcast-inngest-prod ps'"
