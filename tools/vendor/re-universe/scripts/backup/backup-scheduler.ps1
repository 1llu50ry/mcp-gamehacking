# Enhanced Automated Ghidra Repository Backup Scheduler
# Supports configurable backup frequency and smart scheduling

param(
    [string]$Frequency = "",           # Override config: hourly, daily, weekly, manual
    [int]$RetentionDays = 0,          # Override config: days to keep backups
    [string]$BackupPath = "",         # Override config: backup directory
    [string]$LogFile = ".\backup-scheduler.log",
    [switch]$Force                     # Force backup regardless of frequency check
)

# Load configuration from .env file
$config = @{}
if (Test-Path ".\.env") {
    Get-Content ".\.env" | Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_ -match '=' } | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $value = $Matches[2].Trim()
            # Remove inline comments
            if ($value -match '^(.+?)\s*#.*$') {
                $value = $Matches[1].Trim()
            }
            $config[$key] = $value
        }
    }
}

# Apply configuration with fallbacks
$backupFrequency = if ($Frequency) { $Frequency } else { if ($config["BACKUP_FREQUENCY"]) { $config["BACKUP_FREQUENCY"] } else { "daily" } }
$retentionDays = if ($RetentionDays -gt 0) { $RetentionDays } else { if ($config["BACKUP_RETENTION_DAYS"]) { [int]$config["BACKUP_RETENTION_DAYS"] } else { 30 } }
$backupPath = if ($BackupPath) { $BackupPath } else { if ($config["BACKUP_PATH"]) { $config["BACKUP_PATH"] } else { ".\backups" } }
$backupHour = if ($config["BACKUP_HOUR"]) { [int]$config["BACKUP_HOUR"] } else { 2 }
$backupMinute = if ($config["BACKUP_MINUTE"]) { [int]$config["BACKUP_MINUTE"] } else { 0 }
$backupWeekday = if ($config["BACKUP_WEEKDAY"]) { $config["BACKUP_WEEKDAY"] } else { "Sunday" }

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $logEntry
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARN" { "Yellow" }
        "SUCCESS" { "Green" }
        default { "White" }
    }
    Write-Host $logEntry -ForegroundColor $color
}

function Test-BackupNeeded {
    param([string]$Frequency)
    
    if ($Force) {
        Write-Log "Force backup requested" "INFO"
        return $true
    }
    
    # Get last backup time
    $lastBackupFile = Get-ChildItem -Path $backupPath -Filter "auto-backup-*.zip" -ErrorAction SilentlyContinue | 
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    
    $now = Get-Date
    $shouldBackup = $false
    
    if (!$lastBackupFile) {
        Write-Log "No previous backups found, backup needed" "INFO"
        return $true
    }
    
    $lastBackup = $lastBackupFile.LastWriteTime
    $timeSince = $now - $lastBackup
    
    switch ($Frequency.ToLower()) {
        "hourly" {
            $shouldBackup = $timeSince.TotalHours -ge 1
            Write-Log "Hourly check: Last backup $([math]::Round($timeSince.TotalHours, 1)) hours ago" "INFO"
        }
        "daily" {
            $shouldBackup = $timeSince.TotalDays -ge 1
            Write-Log "Daily check: Last backup $([math]::Round($timeSince.TotalDays, 1)) days ago" "INFO"
        }
        "weekly" {
            $shouldBackup = $timeSince.TotalDays -ge 7
            Write-Log "Weekly check: Last backup $([math]::Round($timeSince.TotalDays, 1)) days ago" "INFO"
        }
        "manual" {
            Write-Log "Manual frequency set, skipping automatic backup" "INFO"
            return $false
        }
        default {
            Write-Log "Unknown frequency '$Frequency', defaulting to daily" "WARN"
            $shouldBackup = $timeSince.TotalDays -ge 1
        }
    }
    
    return $shouldBackup
}

function Get-BackupFrequencySchedule {
    param([string]$Frequency)
    
    switch ($Frequency.ToLower()) {
        "hourly" {
            return @{
                Description = "Every hour"
                TaskScheduler = "Triggers: Multiple triggers every hour"
                Cron = "0 * * * *"
            }
        }
        "daily" {
            return @{
                Description = "Daily at $($backupHour):$('{0:D2}' -f $backupMinute)"
                TaskScheduler = "Triggers: Daily at $($backupHour):$('{0:D2}' -f $backupMinute)"
                Cron = "$backupMinute $backupHour * * *"
            }
        }
        "weekly" {
            return @{
                Description = "Weekly on $backupWeekday at $($backupHour):$('{0:D2}' -f $backupMinute)"
                TaskScheduler = "Triggers: Weekly on $backupWeekday at $($backupHour):$('{0:D2}' -f $backupMinute)"
                Cron = "$backupMinute $backupHour * * $(if ($backupWeekday -eq 'Sunday') {'0'} else {'1-6'})"
            }
        }
        default {
            return @{
                Description = "Manual only"
                TaskScheduler = "No automatic schedule"
                Cron = "N/A"
            }
        }
    }
}

Write-Log "=== Backup Scheduler Started ===" "INFO"
Write-Log "Frequency: $backupFrequency | Retention: $retentionDays days | Path: $backupPath" "INFO"

$schedule = Get-BackupFrequencySchedule -Frequency $backupFrequency
Write-Log "Schedule: $($schedule.Description)" "INFO"

try {
    # Check if containers are running
    $containerStatus = docker inspect -f '{{.State.Status}}' ghidra-server 2>$null
    if ($containerStatus -ne "running") {
        Write-Log "Ghidra server is not running, skipping backup" "WARN"
        exit 0
    }
    
    # Check if backup is needed based on frequency
    if (!(Test-BackupNeeded -Frequency $backupFrequency)) {
        Write-Log "Backup not needed based on frequency settings" "INFO"
        exit 0
    }
    
    # Create backup with timestamp and frequency indicator
    $backupName = "auto-$($backupFrequency)-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Log "Creating backup: $backupName" "INFO"
    
    # Run backup script
    Write-Log "Calling backup script with BackupName='$backupName' BackupPath='$backupPath'" "INFO"
    
    & ".\backup.ps1" -BackupName $backupName -BackupPath $backupPath
    
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Backup completed successfully: $backupName" "SUCCESS"
    } else {
        Write-Log "Backup failed with exit code: $LASTEXITCODE" "ERROR"
        exit 1
    }
    
    # Cleanup old backups based on retention policy
    Write-Log "Cleaning up backups older than $retentionDays days" "INFO"
    $cutoffDate = (Get-Date).AddDays(-$retentionDays)
    $oldBackups = Get-ChildItem -Path $backupPath -Filter "auto-*.zip" -ErrorAction SilentlyContinue | 
        Where-Object { $_.LastWriteTime -lt $cutoffDate }
    
    $deletedCount = 0
    foreach ($oldBackup in $oldBackups) {
        Remove-Item $oldBackup.FullName -Force
        Write-Log "Deleted old backup: $($oldBackup.Name)" "INFO"
        $deletedCount++
    }
    
    if ($deletedCount -gt 0) {
        Write-Log "Cleanup complete: $deletedCount old backups removed" "SUCCESS"
    } else {
        Write-Log "No old backups to clean up" "INFO"
    }
    
} catch {
    Write-Log "Automated backup failed: $_" "ERROR"
    exit 1
}

Write-Log "=== Backup Scheduler Completed ===" "SUCCESS"

# Display Windows Task Scheduler setup for current frequency
Write-Host "`n=== Windows Task Scheduler Setup ===" -ForegroundColor Cyan
Write-Host "Current frequency: $($schedule.Description)" -ForegroundColor Yellow
Write-Host "Task Scheduler trigger: $($schedule.TaskScheduler)" -ForegroundColor White
Write-Host "Cron equivalent: $($schedule.Cron)" -ForegroundColor Gray

Write-Host "`n=== Quick Setup Commands ===" -ForegroundColor Cyan
Write-Host "Change to hourly:  .\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value hourly" -ForegroundColor White
Write-Host "Change to weekly:  .\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value weekly" -ForegroundColor White
Write-Host "Set backup time:   .\config.ps1 -Action set -Key BACKUP_HOUR -Value 03" -ForegroundColor White
Write-Host "Test backup now:   .\backup-scheduler.ps1 -Force" -ForegroundColor White
