#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Reset BSim database to force re-initialization

.DESCRIPTION
    This script safely removes the BSim PostgreSQL database volume and recreates
    the container, forcing the auto-initialization scripts to run again.
    
    WARNING: This will DELETE ALL DATA in the BSim database!

.PARAMETER Force
    Skip confirmation prompt

.EXAMPLE
    .\reset-bsim-db.ps1
    # Interactive mode with confirmation

.EXAMPLE
    .\reset-bsim-db.ps1 -Force
    # Non-interactive mode, no confirmation
#>

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Get script directory and project name for volume naming
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectName = (Split-Path -Leaf $ScriptDir).ToLower() -replace '[^a-z0-9]', ''
$VolumeName = "${ProjectName}_bsim_postgres_data"

# Load environment variables from .env if it exists
$EnvFile = Join-Path $ScriptDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove surrounding quotes if present
            $value = $value -replace '^["'']|["'']$', ''
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

# Set defaults if not in .env
$BSimDbUser = if ($env:BSIM_DB_USER) { $env:BSIM_DB_USER } else { "ben" }
$BSimDbName = if ($env:BSIM_DB_NAME) { $env:BSIM_DB_NAME } else { "bsim" }

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "BSim Database Reset Utility" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Warning
Write-Host "⚠️  WARNING: This will DELETE ALL DATA in the BSim database!" -ForegroundColor Red
Write-Host ""
Write-Host "This script will:" -ForegroundColor Yellow
Write-Host "  1. Stop the bsim-postgres container" -ForegroundColor Yellow
Write-Host "  2. Remove the bsim_postgres_data volume (ALL DATA LOST)" -ForegroundColor Yellow
Write-Host "  3. Recreate the container (auto-initialization will run)" -ForegroundColor Yellow
Write-Host ""

# Confirmation
if (-not $Force) {
    $confirmation = Read-Host "Type 'yes' to continue or anything else to cancel"
    if ($confirmation -ne "yes") {
        Write-Host "❌ Reset cancelled by user" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "🔄 Stopping bsim-postgres container..." -ForegroundColor Cyan
docker-compose stop bsim-postgres
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to stop container" -ForegroundColor Red
    exit 1
}

Write-Host "🗑️  Removing bsim-postgres container..." -ForegroundColor Cyan
docker-compose rm -f bsim-postgres
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to remove container" -ForegroundColor Red
    exit 1
}

Write-Host "🗑️  Removing bsim_postgres_data volume ($VolumeName)..." -ForegroundColor Cyan
docker volume rm $VolumeName
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Volume may not exist or already removed" -ForegroundColor Yellow
}

Write-Host "🚀 Recreating bsim-postgres container..." -ForegroundColor Cyan
docker-compose up -d bsim-postgres
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to recreate container" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "✅ BSim database reset successfully!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

Write-Host "⏳ Waiting for initialization to complete (~30 seconds)..." -ForegroundColor Cyan
Write-Host "   Monitor progress: docker logs bsim-postgres -f" -ForegroundColor Gray
Write-Host ""

# Wait for container to be healthy
$maxWait = 60
$waited = 0
$interval = 5

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $waited += $interval
    
    $health = docker inspect bsim-postgres --format='{{.State.Health.Status}}' 2>$null
    
    if ($health -eq "healthy") {
        Write-Host "✅ Container is healthy!" -ForegroundColor Green
        break
    }
    
    Write-Host "⏳ Still initializing... ($waited/$maxWait seconds)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Verify schema: docker exec -it bsim-postgres psql -U $BSimDbUser -d $BSimDbName -c '\dt'" -ForegroundColor Gray
Write-Host "  2. Run tests: .\test-bsim-setup.ps1" -ForegroundColor Gray
Write-Host "  3. Check logs: docker logs bsim-postgres" -ForegroundColor Gray
Write-Host ""
