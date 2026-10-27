# Ghidra Repository Restore Script
param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [switch]$Force
)

Write-Host "=== Ghidra Repository Restore ===" -ForegroundColor Cyan

# Validate backup file exists
if (!(Test-Path $BackupFile)) {
    Write-Host "ERROR: Backup file not found: $BackupFile" -ForegroundColor Red
    exit 1
}

# Check if it's a zip file
if ($BackupFile -notlike "*.zip") {
    Write-Host "ERROR: Backup file must be a .zip archive" -ForegroundColor Red
    exit 1
}

# Extract backup name
$backupName = [System.IO.Path]::GetFileNameWithoutExtension($BackupFile)
Write-Host "Restoring from: $backupName" -ForegroundColor Yellow

# Warning about data loss
if (!$Force) {
    Write-Host "`nWARNING: This will replace all current repository data!" -ForegroundColor Red
    $confirm = Read-Host "Are you sure you want to continue? (yes/no)"
    if ($confirm -ne "yes") {
        Write-Host "Restore cancelled" -ForegroundColor Yellow
        exit 0
    }
}

# Stop containers
Write-Host "`nStopping containers..." -ForegroundColor Yellow
docker-compose stop ghidra-server

try {
    # Create temporary extraction directory
    $tempDir = Join-Path $env:TEMP "ghidra-restore-$([System.Guid]::NewGuid().ToString('N')[0..7] -join '')"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    
    # Extract backup
    Write-Host "Extracting backup archive..." -ForegroundColor Yellow
    Expand-Archive -Path $BackupFile -DestinationPath $tempDir -Force
    
    # Find the backup folder (should be the only subfolder)
    $extractedFolder = Get-ChildItem -Path $tempDir -Directory | Select-Object -First 1
    if (!$extractedFolder) {
        throw "No backup folder found in archive"
    }
    
    # Read metadata if available
    $metadataPath = Join-Path $extractedFolder.FullName "backup-metadata.json"
    if (Test-Path $metadataPath) {
        $metadata = Get-Content $metadataPath | ConvertFrom-Json
        Write-Host "`n=== Backup Information ===" -ForegroundColor Green
        Write-Host "Backup Date: $($metadata.BackupDate)" -ForegroundColor White
        Write-Host "Backup Type: $($metadata.BackupType)" -ForegroundColor White
        if ($metadata.GitCommit) {
            Write-Host "Git Commit: $($metadata.GitCommit)" -ForegroundColor White
        }
    }
    
    # Backup current data (safety backup)
    $safetyBackup = ".\repo-data-safety-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if (Test-Path ".\repo-data") {
        Write-Host "`nCreating safety backup of current data..." -ForegroundColor Yellow
        Copy-Item -Path ".\repo-data" -Destination $safetyBackup -Recurse -Force
        Write-Host "Safety backup created: $safetyBackup" -ForegroundColor Green
    }
    
    # Remove current repo-data and restore from backup
    Write-Host "Restoring repository data..." -ForegroundColor Yellow
    if (Test-Path ".\repo-data") {
        Remove-Item -Path ".\repo-data" -Recurse -Force
    }
    
    # Copy restored data (exclude metadata file)
    Copy-Item -Path $extractedFolder.FullName -Destination ".\repo-data" -Recurse -Force
    Remove-Item -Path ".\repo-data\backup-metadata.json" -Force -ErrorAction SilentlyContinue
    
    Write-Host "`n=== Restore Complete ===" -ForegroundColor Green
    Write-Host "Repository data restored from: $BackupFile" -ForegroundColor White
    Write-Host "Safety backup available at: $safetyBackup" -ForegroundColor White
    
} catch {
    Write-Host "ERROR: Restore failed - $_" -ForegroundColor Red
    exit 1
} finally {
    # Cleanup temp directory
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # Restart containers
    Write-Host "`nRestarting containers..." -ForegroundColor Yellow
    docker-compose start ghidra-server
    Write-Host "Containers restarted" -ForegroundColor Green
}

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Test connectivity: .\test-connectivity.ps1" -ForegroundColor White
Write-Host "2. Connect Ghidra client to localhost:13100" -ForegroundColor White
Write-Host "3. Verify projects are restored correctly" -ForegroundColor White
