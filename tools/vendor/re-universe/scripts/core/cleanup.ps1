# Data Cleanup Script for Ghidra RE Platform
# Removes all data while preserving .gitkeep files for Git tracking

param(
    [switch]$Force,                        # Skip confirmation prompts
    [switch]$DryRun,                      # Show what would be deleted without actually deleting
    [string[]]$SkipFolders = @()          # Additional folders to skip cleanup
)

$ErrorActionPreference = "Stop"

# Folders to clean (relative to workspace root)
$cleanupFolders = @(
    @{ Path = ".\repo-data"; Description = "Ghidra repository data" },
    @{ Path = ".\sync-logs"; Description = "ret-sync logs" },
    @{ Path = ".\backups"; Description = "backup files" }
)

function Write-CleanupLog {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "INFO" { "White" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        "SUCCESS" { "Green" }
        default { "Gray" }
    }
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

function Get-FolderSize {
    param([string]$Path)
    if (Test-Path $Path) {
        $size = (Get-ChildItem $Path -Recurse -File | Measure-Object -Property Length -Sum).Sum
        return [math]::Round($size / 1MB, 2)
    }
    return 0
}

function Show-CleanupPreview {
    Write-CleanupLog "=== Cleanup Preview ===" "INFO"
    
    foreach ($folder in $cleanupFolders) {
        if ($SkipFolders -contains (Split-Path $folder.Path -Leaf)) {
            Write-CleanupLog "SKIPPING: $($folder.Path) - $($folder.Description)" "WARN"
            continue
        }
        
        if (Test-Path $folder.Path) {
            $items = Get-ChildItem $folder.Path -Force | Where-Object { $_.Name -ne ".gitkeep" }
            $size = Get-FolderSize $folder.Path
            
            Write-CleanupLog "FOLDER: $($folder.Path) - $($folder.Description)" "INFO"
            Write-CleanupLog "  Current size: ${size} MB" "INFO"
            Write-CleanupLog "  Items to delete: $($items.Count)" "INFO"
            
            if ($items.Count -gt 0) {
                $items | ForEach-Object {
                    $itemSize = if ($_.PSIsContainer) { 
                        Get-FolderSize $_.FullName 
                    } else { 
                        [math]::Round($_.Length / 1MB, 2) 
                    }
                    $type = if ($_.PSIsContainer) { "DIR " } else { "FILE" }
                    Write-CleanupLog "    [$type] $($_.Name) (${itemSize} MB)" "INFO"
                }
            } else {
                Write-CleanupLog "  No items to delete (only .gitkeep present)" "SUCCESS"
            }
        } else {
            Write-CleanupLog "FOLDER: $($folder.Path) - Not found, will be created" "WARN"
        }
        Write-Host ""
    }
}

function Invoke-Cleanup {
    param([bool]$DryRun = $false)
    
    $totalItemsDeleted = 0
    $totalSizeFreed = 0
    
    foreach ($folder in $cleanupFolders) {
        if ($SkipFolders -contains (Split-Path $folder.Path -Leaf)) {
            Write-CleanupLog "Skipping $($folder.Path) as requested" "WARN"
            continue
        }
        
        if (Test-Path $folder.Path) {
            $originalSize = Get-FolderSize $folder.Path
            $items = Get-ChildItem $folder.Path -Force | Where-Object { $_.Name -ne ".gitkeep" }
            
            if ($items.Count -gt 0) {
                Write-CleanupLog "Cleaning $($folder.Path) - $($folder.Description)" "INFO"
                
                foreach ($item in $items) {
                    if ($DryRun) {
                        Write-CleanupLog "  [DRY RUN] Would delete: $($item.Name)" "WARN"
                    } else {
                        try {
                            if ($item.PSIsContainer) {
                                Remove-Item $item.FullName -Recurse -Force
                                Write-CleanupLog "  Deleted directory: $($item.Name)" "SUCCESS"
                            } else {
                                Remove-Item $item.FullName -Force
                                Write-CleanupLog "  Deleted file: $($item.Name)" "SUCCESS"
                            }
                            $totalItemsDeleted++
                        } catch {
                            Write-CleanupLog "  Failed to delete $($item.Name): $($_.Exception.Message)" "ERROR"
                        }
                    }
                }
                
                if (!$DryRun) {
                    $newSize = Get-FolderSize $folder.Path
                    $freedSpace = $originalSize - $newSize
                    $totalSizeFreed += $freedSpace
                    Write-CleanupLog "  Freed ${freedSpace} MB from $($folder.Path)" "SUCCESS"
                }
            } else {
                Write-CleanupLog "No cleanup needed for $($folder.Path) (only .gitkeep present)" "INFO"
            }
        } else {
            Write-CleanupLog "Creating missing directory: $($folder.Path)" "INFO"
            New-Item -ItemType Directory -Path $folder.Path -Force | Out-Null
            New-Item -ItemType File -Path "$($folder.Path)\.gitkeep" -Force | Out-Null
            Write-CleanupLog "Created $($folder.Path) with .gitkeep" "SUCCESS"
        }
    }
    
    if (!$DryRun -and $totalItemsDeleted -gt 0) {
        Write-CleanupLog "=== Cleanup Summary ===" "SUCCESS"
        Write-CleanupLog "Total items deleted: $totalItemsDeleted" "SUCCESS"
        Write-CleanupLog "Total space freed: ${totalSizeFreed} MB" "SUCCESS"
    }
}

# Main execution
Write-CleanupLog "=== Data Cleanup Tool Started ===" "INFO"

# Show what will be cleaned
Show-CleanupPreview

if ($DryRun) {
    Write-CleanupLog "=== DRY RUN MODE - No actual changes made ===" "WARN"
    Invoke-Cleanup -DryRun $true
    exit 0
}

# Confirmation prompt (unless -Force is used)
if (!$Force) {
    Write-Host "`n" -NoNewline
    Write-Host "⚠️  WARNING: This will permanently delete all data in the specified folders!" -ForegroundColor Red
    Write-Host "   Only .gitkeep files will be preserved." -ForegroundColor Yellow
    Write-Host "`nContinue with cleanup? (y/N): " -NoNewline -ForegroundColor Cyan
    $confirmation = Read-Host
    
    if ($confirmation -notmatch '^[yY].*') {
        Write-CleanupLog "Cleanup cancelled by user" "WARN"
        exit 0
    }
}

# Perform cleanup
Write-CleanupLog "Starting cleanup operation..." "INFO"
Invoke-Cleanup

Write-CleanupLog "=== Data Cleanup Completed ===" "SUCCESS"

# Verification
Write-CleanupLog "Verifying cleanup results..." "INFO"
foreach ($folder in $cleanupFolders) {
    if (Test-Path $folder.Path) {
        $remainingItems = Get-ChildItem $folder.Path -Force | Where-Object { $_.Name -ne ".gitkeep" }
        if ($remainingItems.Count -eq 0) {
            Write-CleanupLog "✅ $($folder.Path) - Clean (only .gitkeep remains)" "SUCCESS"
        } else {
            Write-CleanupLog "⚠️  $($folder.Path) - $($remainingItems.Count) items remain" "WARN"
        }
    }
}

Write-Host "`n=== Usage Examples ===" -ForegroundColor Cyan
Write-Host "Preview cleanup:    .\cleanup.ps1 -DryRun" -ForegroundColor White  
Write-Host "Force cleanup:      .\cleanup.ps1 -Force" -ForegroundColor White
Write-Host "Skip specific dir:  .\cleanup.ps1 -SkipFolders @('backups')" -ForegroundColor White
