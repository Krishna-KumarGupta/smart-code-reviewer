param (
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("start", "stop")]
    [string]$Action,

    [Parameter(Mandatory=$false, Position=1)]
    [ValidateSet("webapp", "webhook", "agent")]
    [string]$Container,

    [Parameter(Mandatory=$false)]
    [switch]$Build
)

Clear-Host

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "      Smart Code Reviewer Manager" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$buildFlag = if ($Build) { "--build" } else { "" }

if ($Action -eq "start") {
    if ($Container) {
        Write-Host "🚀 Starting container: $Container..." -ForegroundColor Green
        if ($buildFlag) {
            # Executing: docker-compose up -d --build <container-name>
            docker-compose up -d --build $Container
        } else {
            # Executing: docker-compose up -d <container-name>
            docker-compose up -d $Container
        }
    } else {
        Write-Host "🚀 Starting all containers..." -ForegroundColor Green
        if ($buildFlag) {
            # Executing: docker-compose up -d --build
            docker-compose up -d --build
        } else {
            # Executing: docker-compose up -d
            docker-compose up -d
        }
    }
}
elseif ($Action -eq "stop") {
    if ($Container) {
        Write-Host "🛑 Stopping container: $Container..." -ForegroundColor Yellow
        # Executing: docker-compose stop <container-name>
        docker-compose stop $Container
    } else {
        Write-Host "🛑 Stopping all containers..." -ForegroundColor Yellow
        # Executing: docker-compose down
        docker-compose down
    }
}

Write-Host "=============================================" -ForegroundColor Cyan