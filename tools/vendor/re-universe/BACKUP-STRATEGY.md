# Ghidra Repository Backup Strategy

## Overview
This backup system provide## Restore Methods protection for your Ghidra Server repository data, including projects, analysis results, and user configurations.

## Backup Methods

### 1. Manual Backups
```powershell
# Create a full backup
.\backup.ps1

# Create a named backup (before major analysis)
.\backup.ps1 -BackupName "before-malware-analysis"

# Quick backup with custom location
.\backup.ps1 -BackupName "project-milestone" -BackupPath "D:\ghidra-backups"
```

### 2. Automated Backups

```powershell
# Use configured frequency from .env file
.\backup-scheduler.ps1

# Override frequency for specific run
.\backup-scheduler.ps1 -Frequency hourly

# Custom retention (keeps 7 days)
.\backup-scheduler.ps1 -RetentionDays 7

# Force backup now (ignore frequency rules)
.\backup-scheduler.ps1 -Force
```

#### Configure Backup Frequency

```powershell
# Set to hourly backups
.\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value hourly

# Set to daily backups at 3 AM
.\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value daily
.\config.ps1 -Action set -Key BACKUP_HOUR -Value 03

# Set to weekly backups on Mondays
.\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value weekly
.\config.ps1 -Action set -Key BACKUP_WEEKDAY -Value Monday

# Disable automatic backups (manual only)
.\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value manual
```

### 3. Git Integration
```powershell
# Important projects can be version controlled
git add repo-data/~admin/important-project/
git commit -m "Analysis checkpoint: malware variant #3"
```

## Restore Methods

### 1. Full Restore
```powershell
# Restore from backup (creates safety backup automatically)
.\restore.ps1 -BackupFile .\backups\ghidra-backup-20240831.zip

# Force restore (skip confirmation)
.\restore.ps1 -BackupFile .\backups\backup.zip -Force
```

### 2. Selective Restore
```powershell
# Extract specific project manually
Expand-Archive .\backups\backup.zip -DestinationPath .\temp
Copy-Item .\temp\backup-folder\~admin\specific-project .\repo-data\~admin\ -Recurse
```

### 3. Managing Backups
```powershell
# List all backups
Get-ChildItem .\backups\*.zip | Sort-Object LastWriteTime -Descending

# List backups with details
Get-ChildItem .\backups\*.zip | Sort-Object LastWriteTime -Descending | ForEach-Object { 
    $size = [math]::Round($_.Length / 1MB, 2)
    $age = (Get-Date) - $_.LastWriteTime
    $ageStr = if ($age.Days -gt 0) { "$($age.Days)d ago" } else { "$($age.Hours)h ago" }
    Write-Host "$($_.Name) - $size MB - $ageStr" 
}

# Clean old backups (keep last 5)
Get-ChildItem .\backups\*.zip | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item -Force
```

## Best Practices

### 1. Backup Frequency Configuration

The backup system supports multiple frequency options:

**Frequency Options:**
- **`hourly`**: Backup every hour (for active development)
- **`daily`**: Once per day at specified time (default: 2:00 AM)
- **`weekly`**: Once per week on specified day (default: Sunday 2:00 AM)
- **`manual`**: No automatic backups, manual only

**Configure Frequency:**
```powershell
# Set backup frequency
.\config.ps1 -Action set -Key BACKUP_FREQUENCY -Value daily

# Set backup time (24-hour format)
.\config.ps1 -Action set -Key BACKUP_HOUR -Value 03
.\config.ps1 -Action set -Key BACKUP_MINUTE -Value 30

# Set weekly backup day
.\config.ps1 -Action set -Key BACKUP_WEEKDAY -Value Monday

# Set retention period
.\config.ps1 -Action set -Key BACKUP_RETENTION_DAYS -Value 14
```

**Windows Task Scheduler Setup:**
```powershell
# View current schedule configuration
.\backup-scheduler.ps1

# The script will display the exact Task Scheduler trigger needed
# Example output: "Triggers: Daily at 03:00"
```

### 2. Backup Frequency Recommendations
- **Development**: Before major analysis sessions
- **Production**: Daily automated backups
- **Critical work**: Manual backups at project milestones

### 2. Storage Recommendations
- **Local**: Fast access, use for recent backups
- **Network**: Shared storage for team environments
- **Cloud**: Long-term retention and disaster recovery

### 3. Backup Validation
```powershell
# Test restore in separate environment
docker-compose -f docker-compose.test.yml up -d
.\restore.ps1 -BackupFile .\backups\test-backup.zip
# Verify projects load correctly
```

## Advanced Features

### 1. Incremental Backups (Future)
- Track file changes using git or rsync
- Only backup modified projects
- Faster backup times for large repositories

### 2. Encrypted Backups (Future)
```powershell
# Encrypt sensitive analysis data
7z a -p"password" backup-encrypted.7z .\backups\backup.zip
```

### 3. Remote Backup Integration
```powershell
# Upload to cloud storage
aws s3 cp .\backups\backup.zip s3://re-backups/
# Or rsync to remote server
rsync -av .\backups\ user@backup-server:/ghidra-backups/
```

## Troubleshooting

### Common Issues
1. **Permission errors**: Run PowerShell as Administrator
2. **Disk space**: Monitor backup directory size
3. **Container conflicts**: Ensure containers stop properly during backup

### Recovery Scenarios
1. **Corrupted project**: Restore specific project from backup
2. **Server misconfiguration**: Full restore to known good state
3. **Hardware failure**: Restore to new environment from remote backup

## Integration with RE Workflow

### Pre-Analysis Backup
```powershell
# Before analyzing new malware sample
.\backup.ps1 -BackupName "before-sample-$(Get-Date -Format 'yyyyMMdd')"
```

### Milestone Backups
```powershell
# After completing major analysis phase
.\backup.ps1 -BackupName "analysis-complete-variant-A"
```

### Team Sharing
```powershell
# Share analysis results with team
Copy-Item .\backups\analysis-results.zip \\shared\re-team\
```
