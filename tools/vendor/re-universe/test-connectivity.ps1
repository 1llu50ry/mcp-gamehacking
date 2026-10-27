# Ghidra Server connectivity test script

# Load environment variables from .env file if it exists
if (Test-Path ".\.env") {
    Get-Content ".\.env" | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $name = $Matches[1].Trim()
            $rawValue = $Matches[2].Trim()
            # Remove inline comments (everything after # if present)
            $value = if ($rawValue -match '^([^#]*?)(\s*#.*)?$') { $Matches[1].Trim() } else { $rawValue }
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Get configuration values (with defaults)
$ghidraPort = [Environment]::GetEnvironmentVariable("GHIDRA_PORT")
if (!$ghidraPort) { $ghidraPort = "13100" }
$ghidraUser = [Environment]::GetEnvironmentVariable("GHIDRA_USERS")
if (!$ghidraUser) { $ghidraUser = "admin" }
$ghidraPassword = "changeme"  # Ghidra server always uses this default password
$containerName = "ghidra-server"

Write-Host "Testing Ghidra Server connectivity..." -ForegroundColor Cyan
Write-Host "Port: $ghidraPort | Container: $containerName" -ForegroundColor Gray

# Test 1: Container status
Write-Host "`nTest 1: Checking Docker container status..." -ForegroundColor Yellow
$containerStatus = docker inspect -f '{{.State.Status}}' $containerName 2>$null
if ($containerStatus -eq "running") {
    Write-Host "OK - Ghidra Server container is running" -ForegroundColor Green
} else {
    Write-Host "ERROR - Ghidra Server container is not running" -ForegroundColor Red
    Write-Host "Container status: $containerStatus" -ForegroundColor Red
    exit 1
}

# Test 2: Port connectivity
Write-Host "`nTest 2: Testing port $ghidraPort connectivity..." -ForegroundColor Yellow
$connection = Test-NetConnection -ComputerName localhost -Port $ghidraPort -WarningAction SilentlyContinue
if ($connection.TcpTestSucceeded) {
    Write-Host "OK - Port $ghidraPort is accessible" -ForegroundColor Green
} else {
    Write-Host "ERROR - Cannot connect to port $ghidraPort" -ForegroundColor Red
    exit 1
}

# Test 3: Server health
Write-Host "`nTest 3: Checking server logs..." -ForegroundColor Yellow
$logs = docker logs $containerName --tail 5 2>&1
$serverReady = $logs | Select-String "Registered Ghidra Server"
if ($serverReady) {
    Write-Host "OK - Ghidra Server is registered and ready" -ForegroundColor Green
} else {
    Write-Host "WARNING - Server may still be initializing" -ForegroundColor Yellow
}

Write-Host "`n=== Connection Details ===" -ForegroundColor Green
Write-Host "Server: localhost:$ghidraPort" -ForegroundColor White
Write-Host "Username: $ghidraUser" -ForegroundColor White
Write-Host "Password: $ghidraPassword" -ForegroundColor White

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Open Ghidra" -ForegroundColor White
Write-Host "2. File -> New Project -> Shared Project" -ForegroundColor White
Write-Host "3. Server: localhost:$ghidraPort" -ForegroundColor White
Write-Host "4. Use $ghidraUser/$ghidraPassword credentials" -ForegroundColor White
Write-Host "5. Create test project" -ForegroundColor White

Write-Host "`nAll tests completed!" -ForegroundColor Green
