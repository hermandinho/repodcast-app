# Push DB stack + env to the VPS, run deploy.sh, then apply Prisma migrations.
#
# Usage (from any directory):
#   $env:DB_HOST = "15.204.114.174"
#   ./infra/db/scripts/push.ps1 prod
#   ./infra/db/scripts/push.ps1 staging
#
# Falls back to $env:WORKER_HOST if $env:DB_HOST is unset — convenient when
# the DB shares a box with the render worker.
#
# Pass -SkipMigrate to deploy the stack without applying migrations (e.g.
# when the schema hasn't changed and you want a faster push).

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('prod', 'staging')]
    [string]$EnvName,

    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

# infra/db/ absolute path — script lives at infra/db/scripts/push.ps1
$DbDir = Split-Path -Parent $PSScriptRoot

$DbHost = $env:DB_HOST
if (-not $DbHost) { $DbHost = $env:WORKER_HOST }
if (-not $DbHost) {
    Write-Error "Neither DB_HOST nor WORKER_HOST is set. Run: `$env:DB_HOST = '<vps-ip>'"
    exit 1
}

$EnvFile   = Join-Path $DbDir ".env.$EnvName"
$RcloneCfg = Join-Path $DbDir "rclone/rclone.conf.$EnvName"

if (-not (Test-Path $EnvFile))   { Write-Error "Missing $EnvFile. Copy .env.example -> .env.$EnvName and fill it in."; exit 1 }
if (-not (Test-Path $RcloneCfg)) { Write-Error "Missing $RcloneCfg. Copy rclone/rclone.conf.example -> rclone/rclone.conf.$EnvName and fill it in."; exit 1 }

$Remote     = "deploy@${DbHost}"
$RemoteRoot = "~/db-${EnvName}"

Write-Host "==> preparing target dirs on $DbHost" -ForegroundColor Cyan
& ssh $Remote "mkdir -p $RemoteRoot/postgres $RemoteRoot/rclone $RemoteRoot/certs $RemoteRoot/backups $RemoteRoot/scripts"

Write-Host "==> pushing docker-compose.yml" -ForegroundColor Cyan
& scp (Join-Path $DbDir 'docker-compose.yml') "${Remote}:${RemoteRoot}/"

Write-Host "==> pushing postgres/*" -ForegroundColor Cyan
& scp (Join-Path $DbDir 'postgres/postgresql.conf') "${Remote}:${RemoteRoot}/postgres/"
& scp (Join-Path $DbDir 'postgres/pg_hba.conf')     "${Remote}:${RemoteRoot}/postgres/"

Write-Host "==> pushing rclone.conf.$EnvName -> rclone/rclone.conf" -ForegroundColor Cyan
& scp $RcloneCfg "${Remote}:${RemoteRoot}/rclone/rclone.conf"
& ssh $Remote "chmod 600 $RemoteRoot/rclone/rclone.conf"

Write-Host "==> pushing scripts/*" -ForegroundColor Cyan
& scp (Join-Path $DbDir 'scripts/deploy.sh')        "${Remote}:${RemoteRoot}/scripts/"
& scp (Join-Path $DbDir 'scripts/renew.sh')         "${Remote}:${RemoteRoot}/scripts/"
& scp (Join-Path $DbDir 'scripts/restore-drill.sh') "${Remote}:${RemoteRoot}/scripts/"
& ssh $Remote "chmod +x $RemoteRoot/scripts/*.sh"

Write-Host "==> pushing .env.$EnvName -> .env" -ForegroundColor Cyan
& scp $EnvFile "${Remote}:${RemoteRoot}/.env"
& ssh $Remote "chmod 600 $RemoteRoot/.env"

Write-Host "==> deploying" -ForegroundColor Cyan
& ssh $Remote "bash $RemoteRoot/scripts/deploy.sh $EnvName"
if ($LASTEXITCODE -ne 0) { Write-Error "deploy.sh exited $LASTEXITCODE"; exit $LASTEXITCODE }

# --- Prisma migrations ------------------------------------------------------
if ($SkipMigrate) {
    Write-Host ""
    Write-Host "==> skipping prisma migrate deploy (-SkipMigrate)" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "==> applying Prisma migrations" -ForegroundColor Cyan

    # Pull password + domain from .env.<env>. Skip comment / blank lines.
    $envMap = @{}
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        $envMap[$key.Trim()] = $value.Trim()
    }
    $password = $envMap['POSTGRES_PASSWORD']
    $domain   = $envMap['DB_DOMAIN']
    $port     = $envMap['PGBOUNCER_PORT']
    if (-not $password) { Write-Error "POSTGRES_PASSWORD not found in $EnvFile"; exit 1 }
    if (-not $domain)   { Write-Error "DB_DOMAIN not found in $EnvFile"; exit 1 }
    if (-not $port)     { $port = '6432' }  # default matches docker-compose.yml

    # Strip surrounding quotes if the user pasted them into .env.
    $password = $password.Trim('"', "'")

    # URL-encode password — handles /, +, @, :, %, etc.
    $encodedPw = [System.Uri]::EscapeDataString($password)

    $baseUrl   = "postgresql://repodcast:${encodedPw}@${domain}:${port}/repodcast?sslmode=require"
    $dbUrl     = "${baseUrl}&pgbouncer=true"
    $directUrl = "${baseUrl}&pgbouncer=false"

    # Repo root: infra/db/scripts → ../../..
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $DbDir)

    # Invoke prisma via the local binary directly — `npx prisma` on Windows
    # PowerShell is flaky ("could not determine executable to run" from
    # PowerShell contexts that don't inherit npm's shim resolution cleanly).
    $prismaCmd = Join-Path $RepoRoot 'node_modules\.bin\prisma.cmd'
    if (-not (Test-Path $prismaCmd)) {
        Write-Error "prisma binary not found at $prismaCmd. Run ``npm install`` in the repo root first."
        exit 1
    }

    Push-Location $RepoRoot
    try {
        $env:DATABASE_URL = $dbUrl
        $env:DIRECT_URL   = $directUrl
        & $prismaCmd migrate deploy
        if ($LASTEXITCODE -ne 0) { Write-Error "prisma migrate deploy exited $LASTEXITCODE"; exit $LASTEXITCODE }
    } finally {
        Pop-Location
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:DIRECT_URL   -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "==> done." -ForegroundColor Green
Write-Host "    ssh $Remote 'docker compose --env-file ~/db-$EnvName/.env -p repodcast-db-$EnvName ps'"
