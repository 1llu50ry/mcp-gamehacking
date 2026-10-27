# Configuration Management Script for Ghidra RE Platform
param(
    [string]$Action = "show",  # show, set, reset, validate
    [string]$Key = "",
    [string]$Value = ""
)

$envFile = ".\.env"
$exampleFile = ".\.env.example"

function Show-Configuration {
    Write-Host "=== Current Configuration ===" -ForegroundColor Cyan
    
    if (!(Test-Path $envFile)) {
        Write-Host "No .env file found. Creating from example..." -ForegroundColor Yellow
        Copy-Item $exampleFile $envFile
    }
    
    Write-Host "`nLoaded from ${envFile}:" -ForegroundColor Green
    Get-Content $envFile | Where-Object { $_ -match '^[^#].*=' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $key = $parts[0].Trim()
        $val = $parts[1].Trim()
        Write-Host "  $key = $val" -ForegroundColor White
    }
    
    Write-Host "`n=== Configuration Categories ===" -ForegroundColor Cyan
    Write-Host "ðŸ–¥ï¸  Ghidra Server: GHIDRA_IP, GHIDRA_PORT, JVM_MAX_MEMORY, GHIDRA_USERS (password is always 'changeme')" -ForegroundColor Yellow
    Write-Host "ðŸ”„ ret-sync: RETSYNC_PORT, RETSYNC_IP" -ForegroundColor Yellow  
    Write-Host "ðŸ’¾ Storage: REPO_DATA_PATH, SYNC_LOGS_PATH, BACKUP_PATH" -ForegroundColor Yellow
    Write-Host "â° Backup: BACKUP_FREQUENCY, BACKUP_HOUR, BACKUP_RETENTION_DAYS" -ForegroundColor Yellow
}

function Set-ConfigValue {
    param([string]$Key, [string]$Value)
    
    if (!(Test-Path $envFile)) {
        Copy-Item $exampleFile $envFile
        Write-Host "Created .env file from example" -ForegroundColor Green
    }
    
    $content = Get-Content $envFile
    $updated = $false
    $newContent = @()
    
    foreach ($line in $content) {
        if ($line -match "^$Key\s*=") {
            $newContent += "$Key=$Value"
            $updated = $true
            Write-Host "Updated: $Key = $Value" -ForegroundColor Green
        } else {
            $newContent += $line
        }
    }
    
    if (!$updated) {
        $newContent += "$Key=$Value"
        Write-Host "Added: $Key = $Value" -ForegroundColor Green
    }
    
    $newContent | Out-File -FilePath $envFile -Encoding UTF8
}

function Reset-Configuration {
    Write-Host "Resetting configuration to defaults..." -ForegroundColor Yellow
    Copy-Item $exampleFile $envFile -Force
    Write-Host "Configuration reset to example defaults" -ForegroundColor Green
}

function Test-Configuration {
    Write-Host "=== Configuration Validation ===" -ForegroundColor Cyan
    
    if (!(Test-Path $envFile)) {
        Write-Host "No .env file found. Creating from example..." -ForegroundColor Yellow
        if (Test-Path $exampleFile) {
            Copy-Item $exampleFile $envFile
            Write-Host "✅ Created .env file from example" -ForegroundColor Green
        } else {
            Write-Host "❌ No .env.example file found" -ForegroundColor Red
            return $false
        }
    }
    
    # Parse the .env file
    $config = @{}
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and !$line.StartsWith("#")) {
            if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
                $key = $Matches[1]
                $rawValue = $Matches[2].Trim()
                # Remove inline comments (everything after # if present)
                $value = if ($rawValue -match '^([^#]*?)(\s*#.*)?$') { $Matches[1].Trim() } else { $rawValue }
                $config[$key] = $value
            }
        }
    }
    
    $valid = $true
    
    # Validate required settings
    $required = @("GHIDRA_IP", "GHIDRA_PORT", "JVM_MAX_MEMORY", "GHIDRA_USERS")
    foreach ($req in $required) {
        if (!$config.ContainsKey($req) -or [string]::IsNullOrWhiteSpace($config[$req])) {
            Write-Host "âŒ Missing required setting: $req" -ForegroundColor Red
            $valid = $false
        } else {
            Write-Host "âœ… $req = $($config[$req])" -ForegroundColor Green
        }
    }
    
    # Validate port numbers
    $ports = @("GHIDRA_PORT", "RETSYNC_PORT", "GHIDRA_PORT_RANGE_START", "GHIDRA_PORT_RANGE_END")
    foreach ($port in $ports) {
        if ($config.ContainsKey($port)) {
            $portNum = 0
            if ([int]::TryParse($config[$port], [ref]$portNum)) {
                if ($portNum -lt 1024 -or $portNum -gt 65535) {
                    Write-Host "âš ï¸  $port ($portNum) outside recommended range (1024-65535)" -ForegroundColor Yellow
                }
            } else {
                Write-Host "âŒ Invalid port number for ${port}: $($config[$port])" -ForegroundColor Red
                $valid = $false
            }
        }
    }
    
    # Validate memory setting
    if ($config.ContainsKey("JVM_MAX_MEMORY")) {
        if ($config["JVM_MAX_MEMORY"] -notmatch '^\d+[gGmM]$') {
            Write-Host "âŒ Invalid memory format for JVM_MAX_MEMORY: $($config['JVM_MAX_MEMORY'])" -ForegroundColor Red
            Write-Host "   Use format like: 2g, 4g, 8g, 512m" -ForegroundColor Gray
            $valid = $false
        }
    }
    return $valid
}

# Main script logic
switch ($Action.ToLower()) {
    "show" { 
        Show-Configuration 
    }
    "set" {
        if ([string]::IsNullOrWhiteSpace($Key) -or [string]::IsNullOrWhiteSpace($Value)) {
            Write-Host "ERROR: Both Key and Value are required for set action" -ForegroundColor Red
            Write-Host "Usage: .\config.ps1 -Action set -Key GHIDRA_PORT -Value 13200" -ForegroundColor Gray
            exit 1
        }
        Set-ConfigValue -Key $Key -Value $Value
    }
    "reset" {
        Reset-Configuration
    }
    "validate" {
        $isValid = Test-Configuration
        if ($isValid) {
            Write-Host "`nâœ… Configuration is valid" -ForegroundColor Green
        } else {
            Write-Host "`nâŒ Configuration has errors" -ForegroundColor Red
            exit 1
        }
    }
    default {
        Write-Host "Invalid action: $Action" -ForegroundColor Red
        Write-Host "Valid actions: show, set, reset, validate" -ForegroundColor Gray
        exit 1
    }
}

Write-Host "`n=== Usage Examples ===" -ForegroundColor Cyan
Write-Host "Show config:     .\config.ps1" -ForegroundColor White
Write-Host "Set value:       .\config.ps1 -Action set -Key GHIDRA_PORT -Value 13200" -ForegroundColor White
Write-Host "Validate config: .\config.ps1 -Action validate" -ForegroundColor White
Write-Host "Reset to default: .\config.ps1 -Action reset" -ForegroundColor White

