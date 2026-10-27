# Ghidra Repository Backup Script
param(
    [string]$BackupName = "",
    [string]$BackupPath = ".\backups",
    [switch]$Incremental
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$defaultName = "ghidra-backup-$timestamp"
$backupName = if ($BackupName) { $BackupName } else { $defaultName }

Write-Host "=== Ghidra Repository Backup ===" -ForegroundColor Cyan
Write-Host "Backup name: $backupName" -ForegroundColor Yellow

# Ensure backup directory exists
if (!(Test-Path $BackupPath)) {
    New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    Write-Host "Created backup directory: $BackupPath" -ForegroundColor Green
}

# Stop containers to ensure consistent backup
Write-Host "`nStopping containers for consistent backup..." -ForegroundColor Yellow
docker-compose stop ghidra-server

try {
    # Create backup directory
    $fullBackupPath = Join-Path $BackupPath $backupName
    New-Item -ItemType Directory -Path $fullBackupPath -Force | Out-Null
    
    # Backup repository data
    Write-Host "Backing up repository data..." -ForegroundColor Yellow
    Copy-Item -Path ".\repo-data\*" -Destination $fullBackupPath -Recurse -Force
    
    # Create metadata file
    $metadata = @{
        BackupDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        BackupName = $backupName
        BackupType = if ($Incremental) { "Incremental" } else { "Full" }
        SourcePath = Resolve-Path ".\repo-data"
        GitCommit = (git rev-parse HEAD 2>$null)
        DockerImage = (docker-compose config | Select-String "image.*ghidra" | ForEach-Object { $_.ToString().Split(":")[1].Trim() })
    }
    
    $metadata | ConvertTo-Json | Out-File -FilePath (Join-Path $fullBackupPath "backup-metadata.json") -Encoding UTF8
    
    # Create compressed archive
    Write-Host "Creating compressed archive..." -ForegroundColor Yellow
    $archivePath = Join-Path $BackupPath "$backupName.zip"
    Compress-Archive -Path $fullBackupPath -DestinationPath $archivePath -Force
    
    # Calculate size
    $size = (Get-Item $archivePath).Length / 1MB
    
    Write-Host "`n=== Backup Complete ===" -ForegroundColor Green
    Write-Host "Archive: $archivePath" -ForegroundColor White
    Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor White
    Write-Host "Folder: $fullBackupPath" -ForegroundColor White
    
    # Cleanup uncompressed backup folder (automatic)
    Write-Host "`nRemoving uncompressed backup folder..." -ForegroundColor Yellow
    Remove-Item -Path $fullBackupPath -Recurse -Force
    Write-Host "Uncompressed backup folder removed" -ForegroundColor Green
    
} catch {
    Write-Host "ERROR: Backup failed - $_" -ForegroundColor Red
    exit 1
} finally {
    # Restart containers
    Write-Host "`nRestarting containers..." -ForegroundColor Yellow
    docker-compose start ghidra-server
    Write-Host "Containers restarted" -ForegroundColor Green
}

Write-Host "`n=== Usage Tips ===" -ForegroundColor Cyan
Write-Host "List backups: Get-ChildItem .\backups\*.zip" -ForegroundColor White
Write-Host "Restore: .\restore.ps1 -BackupFile .\backups\$backupName.zip" -ForegroundColor White
