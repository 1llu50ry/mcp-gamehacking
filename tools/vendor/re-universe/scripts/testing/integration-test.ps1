# Integration Test Script for Ghidra RE Platform
# Tests the complete platform workflow from setup to operation

param(
    [switch]$SkipDocker,
    [switch]$KeepArtifacts
)

# Test configuration
$TestBackupName = "integration-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$CleanupOnExit = !$KeepArtifacts

# Cleanup function
function Invoke-Cleanup {
    if ($CleanupOnExit) {
        Write-Host "`nCleaning up integration test..." -ForegroundColor Yellow
        try {
            & .\stop.ps1 2>$null | Out-Null
            docker-compose down --volumes --remove-orphans 2>$null | Out-Null
            
            # Remove test backup if it exists
            Remove-Item "backups\$TestBackupName.zip" -ErrorAction SilentlyContinue
            
            Write-Host "Cleanup completed" -ForegroundColor Green
        } catch {
            Write-Host "Cleanup encountered errors (this is normal)" -ForegroundColor Yellow
        }
    }
}

# Register cleanup for script exit
Register-EngineEvent PowerShell.Exiting -Action { Invoke-Cleanup }

Write-Host "=== Ghidra RE Platform - Integration Test Suite ===" -ForegroundColor Cyan
Write-Host "Testing complete platform workflow...`n"

try {
    # Test 1: Environment Setup
    Write-Host "[1/8] Testing Environment Setup" -ForegroundColor Cyan
    try {
        if ($SkipDocker) {
            & .\setup.ps1 -SkipDockerPull | Out-Null
        } else {
            & .\setup.ps1 | Out-Null
        }
        Write-Host "✅ Environment setup successful" -ForegroundColor Green
    } catch {
        Write-Host "❌ Environment setup failed" -ForegroundColor Red
        throw
    }

    # Test 2: Configuration Management
    Write-Host "[2/8] Testing Configuration Management" -ForegroundColor Cyan
    try {
        & .\config.ps1 -Action validate | Out-Null
        Write-Host "✅ Configuration validation successful" -ForegroundColor Green
    } catch {
        Write-Host "❌ Configuration validation failed" -ForegroundColor Red
        throw
    }

    # Test 3: Platform Startup
    Write-Host "[3/8] Testing Platform Startup" -ForegroundColor Cyan
    try {
        & .\start.ps1 | Out-Null
        Write-Host "✅ Platform startup successful" -ForegroundColor Green
        Start-Sleep -Seconds 30  # Allow services to fully initialize
    } catch {
        Write-Host "❌ Platform startup failed" -ForegroundColor Red
        throw
    }

    # Test 4: Connectivity Verification
    Write-Host "[4/8] Testing Connectivity" -ForegroundColor Cyan
    try {
        & .\test-connectivity.ps1 | Out-Null
        Write-Host "✅ Connectivity test successful" -ForegroundColor Green
    } catch {
        Write-Host "❌ Connectivity test failed" -ForegroundColor Red
        throw
    }

    # Test 5: Backup Creation
    Write-Host "[5/8] Testing Backup System" -ForegroundColor Cyan
    try {
        # Create some test data first
        "integration test data" | Out-File "repo-data\integration-test.txt"
        
        & .\backup.ps1 -BackupName $TestBackupName | Out-Null
        if (Test-Path "backups\$TestBackupName.zip") {
            Write-Host "✅ Backup creation successful" -ForegroundColor Green
        } else {
            throw "Backup file not created"
        }
    } catch {
        Write-Host "❌ Backup creation failed: $_" -ForegroundColor Red
        throw
    }

    # Test 6: Platform Restart
    Write-Host "[6/8] Testing Platform Restart" -ForegroundColor Cyan
    try {
        & .\stop.ps1 | Out-Null
        Write-Host "✅ Platform shutdown successful" -ForegroundColor Green
        Start-Sleep -Seconds 10
        
        & .\start.ps1 | Out-Null
        Write-Host "✅ Platform restart successful" -ForegroundColor Green
        Start-Sleep -Seconds 30
    } catch {
        Write-Host "❌ Platform restart failed" -ForegroundColor Red
        throw
    }

    # Test 7: Backup Restoration
    Write-Host "[7/8] Testing Backup Restoration" -ForegroundColor Cyan
    try {
        # Remove test data to simulate data loss
        Remove-Item "repo-data\integration-test.txt" -ErrorAction SilentlyContinue
        
        # Stop platform for restore
        & .\stop.ps1 | Out-Null
        Start-Sleep -Seconds 5
        
        & .\restore.ps1 -BackupFile "backups\$TestBackupName.zip" -Force | Out-Null
        
        # Restart platform to verify restore
        & .\start.ps1 | Out-Null
        Start-Sleep -Seconds 30
        
        # Check if test data was restored
        if (Test-Path "repo-data\integration-test.txt") {
            Write-Host "✅ Backup restoration successful" -ForegroundColor Green
        } else {
            throw "Test data not found after restore"
        }
    } catch {
        Write-Host "❌ Backup restoration failed: $_" -ForegroundColor Red
        throw
    }

    # Test 8: Cleanup Validation
    Write-Host "[8/8] Testing Cleanup System" -ForegroundColor Cyan
    try {
        & .\cleanup.ps1 -DryRun | Out-Null
        Write-Host "✅ Cleanup dry run successful" -ForegroundColor Green
    } catch {
        Write-Host "❌ Cleanup dry run failed" -ForegroundColor Red
        throw
    }

    # Final connectivity test
    Write-Host "Final Connectivity Verification" -ForegroundColor Cyan
    try {
        & .\test-connectivity.ps1 | Out-Null
        Write-Host "✅ Final connectivity test successful" -ForegroundColor Green
    } catch {
        Write-Host "❌ Final connectivity test failed" -ForegroundColor Red
        throw
    }

    # Integration test summary
    Write-Host "`n🎉 Integration Test Suite PASSED" -ForegroundColor Green
    Write-Host "All 8 test categories completed successfully:" -ForegroundColor White
    Write-Host "  ✅ Environment Setup" -ForegroundColor White
    Write-Host "  ✅ Configuration Management" -ForegroundColor White
    Write-Host "  ✅ Platform Startup" -ForegroundColor White
    Write-Host "  ✅ Connectivity Verification" -ForegroundColor White
    Write-Host "  ✅ Backup Creation" -ForegroundColor White
    Write-Host "  ✅ Platform Restart" -ForegroundColor White
    Write-Host "  ✅ Backup Restoration" -ForegroundColor White
    Write-Host "  ✅ Cleanup Validation" -ForegroundColor White

    Write-Host "`nPlatform is fully operational and ready for production use!" -ForegroundColor Cyan

} catch {
    Write-Host "`n❌ Integration test failed: $_" -ForegroundColor Red
    Write-Host "Check the error messages above for details." -ForegroundColor Yellow
    exit 1
}
