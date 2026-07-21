param (
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("start", "stop")]
    [string]$Action,

    [Parameter(Mandatory=$false, Position=1)]
    [ValidateSet("webapp", "webhook", "agent")]
    [string]$Container
)

Clear-Host

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "      Smart Code Reviewer Manager" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

if ($Action -eq "start") {
    if ($Container) {
        Write-Host "🚀 Starting container: $Container..." -ForegroundColor Green
        docker compose up -d --build $Container
    } else {
        Write-Host "🚀 Starting all containers..." -ForegroundColor Green
        docker compose up -d --build
    }
}
elseif ($Action -eq "stop") {
    if ($Container) {
        Write-Host "🛑 Stopping container: $Container..." -ForegroundColor Yellow
        docker compose stop $Container
    } else {
        Write-Host "🛑 Stopping all containers..." -ForegroundColor Yellow
        docker compose down
    }
}

Write-Host "=============================================" -ForegroundColor Cyan
