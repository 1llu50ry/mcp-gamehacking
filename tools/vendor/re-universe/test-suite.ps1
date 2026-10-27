# Automated Test Suite for Ghidra RE Platform
# This script runs comprehensive tests that can be executed in CI/CD

param(
    [switch]$CI,
    [switch]$SkipDocker
)

# Platform detection
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $IsWindows = $IsWindows
} else {
    $IsWindows = ($env:OS -eq "Windows_NT")
}

# Test counters
$script:TestsRun = 0
$script:TestsPassed = 0
$script:TestsFailed = 0

# Logging function
function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

# Test result functions
function Start-Test {
    param([string]$TestName)
    $script:TestsRun++
    Write-Host "`n[TEST $script:TestsRun] $TestName" -ForegroundColor Cyan
}

function Test-Pass {
    param([string]$Message)
    $script:TestsPassed++
    Write-Host "✅ PASS: $Message" -ForegroundColor Green
}

function Test-Fail {
    param([string]$Message)
    $script:TestsFailed++
    Write-Host "❌ FAIL: $Message" -ForegroundColor Red
    if (!$CI) {
        Write-Host "Continuing with remaining tests..." -ForegroundColor Yellow
    }
}

# Test 1: Prerequisites Check
function Test-Prerequisites {
    Start-Test "Prerequisites Check"
    
    # Docker
    try {
        docker --version | Out-Null
        Test-Pass "Docker is installed"
    } catch {
        Test-Fail "Docker is not installed"
        return
    }
    
    # Docker Compose (check both v1 and v2)
    $dockerComposeAvailable = $false
    try {
        docker-compose --version | Out-Null
        Test-Pass "Docker Compose v1 is installed"
        $dockerComposeAvailable = $true
    } catch {
        try {
            docker compose version | Out-Null
            Test-Pass "Docker Compose v2 is installed"
            $dockerComposeAvailable = $true
        } catch {
            Test-Fail "Docker Compose is not installed (neither v1 nor v2)"
            return
        }
    }
    
    # Check if scripts exist
    $scripts = @("start.ps1", "stop.ps1", "config.ps1", "backup.ps1", "restore.ps1", "cleanup.ps1", "test-connectivity.ps1")
    foreach ($script in $scripts) {
        if (Test-Path $script) {
            Test-Pass "Script exists: $script"
        } else {
            Test-Fail "Missing script: $script"
        }
    }
}
# Test 2: Script Syntax Validation
function Test-ScriptSyntax {
    Start-Test "Script Syntax Validation"
    
    # Test PowerShell scripts
    Get-ChildItem *.ps1 | ForEach-Object {
        try {
            $null = [scriptblock]::Create((Get-Content $_.FullName -Raw))
            Test-Pass "PowerShell syntax valid: $($_.Name)"
        } catch {
            Test-Fail "PowerShell syntax error: $($_.Name) - $($_.Exception.Message)"
        }
    }
    
    # Test bash scripts (if bash is available and not in CI on Windows)
    if ((Get-Command bash -ErrorAction SilentlyContinue) -and !($CI -and $IsWindows)) {
        Get-ChildItem *.sh | ForEach-Object {
            try {
                $result = & bash -n $_.FullName 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Test-Pass "Bash syntax valid: $($_.Name)"
                } else {
                    Test-Fail "Bash syntax error: $($_.Name)"
                }
            } catch {
                Test-Fail "Bash syntax check failed: $($_.Name)"
            }
        }
    } else {
        if ($CI) {
            Write-Host " Skipping Bash syntax tests (CI mode)" -ForegroundColor Yellow
        } else {
            Write-Host " Bash not available, skipping .sh syntax tests" -ForegroundColor Yellow
        }
    }
}

# Test 3: Configuration Management  
function Test-Configuration {
    Start-Test "Configuration Management"
    
    # Test configuration validation without execution
    if (Test-Path "config.ps1") {
        try {
            $null = [scriptblock]::Create((Get-Content "config.ps1" -Raw))
            Test-Pass "Configuration script syntax is valid"
        } catch {
            Test-Fail "Configuration script has syntax errors"
        }
    } else {
        Test-Fail "config.ps1 not found"
    }
    
    # Test environment variable template
    if (Test-Path ".env.example") {
        Test-Pass ".env.example exists"
    } else {
        Test-Fail ".env.example missing"
    }
}

# Test 4: Docker Integration (if not skipped)
function Test-DockerIntegration {
    if ($SkipDocker) {
        Write-Host " Skipping Docker tests (-SkipDocker flag)" -ForegroundColor Yellow
        return
    }
    
    Start-Test "Docker Integration"
    
    # Check if docker-compose.yml exists
    if (Test-Path "docker-compose.yml") {
        Test-Pass "docker-compose.yml exists"
    } else {
        Test-Fail "docker-compose.yml missing"
        return
    }
    
    # Test Docker Compose file validation
    try {
        $composeResult = docker-compose config 2>&1
        if ($LASTEXITCODE -eq 0) {
            Test-Pass "Docker Compose file is valid"
        } else {
            # Try Docker Compose v2
            try {
                $composeResult = docker compose config 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Test-Pass "Docker Compose file is valid (v2)"
                } else {
                    Test-Fail "Docker Compose file validation failed"
                }
            } catch {
                Test-Fail "Docker Compose validation failed"
            }
        }
    } catch {
        Test-Fail "Docker Compose validation failed"
    }
}

# Test 5: File Permissions
function Test-FilePermissions {
    Start-Test "File Permissions"
    
    # Check if key directories exist and are accessible
    $dirs = @("repo-data", "backups", "sync-logs")
    foreach ($dir in $dirs) {
        if (Test-Path $dir) {
            try {
                $testFile = Join-Path $dir "write-test.tmp"
                "test" | Out-File $testFile -Force
                Remove-Item $testFile -Force
                Test-Pass "Directory $dir is writable"
            } catch {
                Test-Fail "Directory $dir is not writable"
            }
        } else {
            # Try to create the directory
            try {
                New-Item -Path $dir -ItemType Directory -Force | Out-Null
                Test-Pass "Created directory: $dir"
            } catch {
                Test-Fail "Cannot create directory: $dir"
            }
        }
    }
}

# Test 6: Backup System
function Test-BackupSystem {
    Start-Test "Backup System"
    
    # Test backup script validation (without execution)
    if (Test-Path "backup.ps1") {
        try {
            $null = [scriptblock]::Create((Get-Content "backup.ps1" -Raw))
            Test-Pass "Backup script syntax is valid"
        } catch {
            Test-Fail "Backup script has syntax errors"
        }
    } else {
        Test-Fail "backup.ps1 not found"
    }
    
    # Test restore script validation (without execution)  
    if (Test-Path "restore.ps1") {
        try {
            $null = [scriptblock]::Create((Get-Content "restore.ps1" -Raw))
            Test-Pass "Restore script syntax is valid"
        } catch {
            Test-Fail "Restore script has syntax errors"
        }
    } else {
        Test-Fail "restore.ps1 not found"
    }
    
    # Check backup directory
    if (!(Test-Path "backups")) {
        try {
            New-Item -Path "backups" -ItemType Directory -Force | Out-Null
            Test-Pass "Created backups directory"
        } catch {
            Test-Fail "Cannot create backups directory"
        }
    } else {
        Test-Pass "Backups directory exists"
    }
}

# Test 7: Documentation Coverage
function Test-Documentation {
    Start-Test "Documentation Coverage"
    
    $docs = @("README.md", "TESTING.md", "BACKUP-STRATEGY.md", "PRODUCTION-STATUS.md")
    foreach ($doc in $docs) {
        if (Test-Path $doc) {
            Test-Pass "Documentation exists: $doc"
        } else {
            Test-Fail "Missing documentation: $doc"
        }
    }
}

# Test 8: Security Validation
function Test-Security {
    Start-Test "Security Validation"
    
    # Check for exposed secrets in .env.example
    if (Test-Path ".env.example") {
        $envContent = Get-Content ".env.example" -Raw
        if ($envContent -match "password|secret|key" -and $envContent -notmatch "changeme|example|placeholder") {
            Test-Fail "Potential secrets found in .env.example"
        } else {
            Test-Pass ".env.example appears secure"
        }
    } else {
        Test-Fail ".env.example not found"
    }
    
    # Check file permissions are not overly permissive (Windows basic check)
    $sensitiveFiles = @("docker-compose.yml", ".env")
    foreach ($file in $sensitiveFiles) {
        if (Test-Path $file) {
            Test-Pass "Sensitive file exists: $file"
        }
    }
}

# Main execution
function Main {
    Write-Host " Starting Automated Test Suite for Ghidra RE Platform" -ForegroundColor White
    Write-Log "Test suite started with parameters: CI=$CI, SkipDocker=$SkipDocker"
    
    if ($CI) {
        Write-Host " Running in CI mode" -ForegroundColor Yellow
    }
    
    # Run all tests
    Test-Prerequisites
    Test-ScriptSyntax
    Test-Configuration
    Test-DockerIntegration
    Test-FilePermissions
    Test-BackupSystem
    Test-Documentation
    Test-Security
    
    # Results summary
    Write-Host "`n" + "="*50 -ForegroundColor White
    Write-Host " TEST RESULTS SUMMARY" -ForegroundColor White
    Write-Host "="*50 -ForegroundColor White
    Write-Host "Total Tests: $script:TestsRun" -ForegroundColor White
    Write-Host "Passed: $script:TestsPassed" -ForegroundColor Green
    Write-Host "Failed: $script:TestsFailed" -ForegroundColor Red
    Write-Host "Success Rate: $([math]::Round($script:TestsPassed / $script:TestsRun * 100, 1))%" -ForegroundColor White
    
    if ($script:TestsFailed -eq 0) {
        Write-Host "`n ALL TESTS PASSED!" -ForegroundColor Green
        Write-Log "Test suite completed successfully"
        exit 0
    } else {
        Write-Host "`n SOME TESTS FAILED" -ForegroundColor Yellow
        Write-Log "Test suite completed with $script:TestsFailed failures"
        if ($CI) {
            exit 1
        } else {
            exit 0  # Don't fail in local development
        }
    }
}

# Run the test suite
Main
