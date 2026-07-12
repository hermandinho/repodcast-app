# Push code + env to the VPS, then run deploy.sh for the given env.
#
# Usage (from any directory):
#   $env:WORKER_HOST = "15.204.114.174"
#   ./worker/scripts/push.ps1 prod
#   ./worker/scripts/push.ps1 staging

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('prod', 'staging')]
    [string]$EnvName
)

$ErrorActionPreference = 'Stop'

# worker/ absolute path — script lives at worker/scripts/push.ps1
$WorkerDir = Split-Path -Parent $PSScriptRoot

$WorkerHost = $env:WORKER_HOST
if (-not $WorkerHost) {
    Write-Error "WORKER_HOST is not set. Run: `$env:WORKER_HOST = '15.204.114.174'"
    exit 1
}

$EnvFile = Join-Path $WorkerDir ".env.$EnvName"
if (-not (Test-Path $EnvFile)) {
    Write-Error "Missing $EnvFile. Copy .env.example -> .env.$EnvName and fill it in."
    exit 1
}

$Remote = "deploy@${WorkerHost}"
$RemoteRoot = "~/${EnvName}"

# Files that ship as-is at the top of the env dir on the box.
$TopFiles = @('Dockerfile', 'docker-compose.yml', 'package.json', 'package-lock.json', 'tsconfig.json') |
    ForEach-Object { Join-Path $WorkerDir $_ }

foreach ($f in $TopFiles) {
    if (-not (Test-Path $f)) { Write-Error "Missing: $f"; exit 1 }
}

Write-Host "==> preparing target dirs on $WorkerHost" -ForegroundColor Cyan
& ssh $Remote "mkdir -p $RemoteRoot/src $RemoteRoot/scripts"

Write-Host "==> pushing top-level files" -ForegroundColor Cyan
& scp $TopFiles "${Remote}:${RemoteRoot}/"

Write-Host "==> pushing src/" -ForegroundColor Cyan
& scp -r (Join-Path $WorkerDir 'src\*') "${Remote}:${RemoteRoot}/src/"

Write-Host "==> pushing scripts/deploy.sh" -ForegroundColor Cyan
& scp (Join-Path $WorkerDir 'scripts\deploy.sh') "${Remote}:${RemoteRoot}/scripts/"

Write-Host "==> pushing .env.$EnvName -> .env" -ForegroundColor Cyan
& scp $EnvFile "${Remote}:${RemoteRoot}/.env"
& ssh $Remote "chmod 600 $RemoteRoot/.env"

Write-Host "==> deploying" -ForegroundColor Cyan
& ssh $Remote "bash $RemoteRoot/scripts/deploy.sh $EnvName"

$domain = if ($EnvName -eq 'prod') { 'render.repodcastapp.com' } else { 'render-staging.repodcastapp.com' }
Write-Host ""
Write-Host "==> done. verify:" -ForegroundColor Green
Write-Host "    curl https://$domain/healthz"
