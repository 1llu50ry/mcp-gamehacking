# Behavioral evidence for the PowerShell bundle's offline spool: the
# entry writer's on-disk contract (file name, SpoolEntry fields, no BOM,
# token handling) and a refused-connection drain pass that keeps the
# backlog. Pure functions plus a connection-refused loopback POST — no
# live server. Invoked by tests/hooks/test_lib.sh when pwsh is available;
# exits non-zero on any failed assertion.

param([Parameter(Mandatory = $true)] [string] $PsLib)

$ErrorActionPreference = "Stop"
. $PsLib

function Assert-True($value, $label) {
    if (-not $value) { throw "spool ps probe failed: $label" }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("am-spool-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $root | Out-Null
$env:AI_MEMORY_DATA_DIR = (Join-Path $root "data")
# Port 1 is reserved and never listens: connection refused, immediately.
$RefusedUrl = "http://127.0.0.1:1/hook?event=stop&agent=codex&ingest_key=ps0000000000000000"

# 1. The lib captured its own path so the detached drain child can be
#    pointed back at this exact file.
Assert-True ($script:AiMemoryLibFile -and ((Split-Path $script:AiMemoryLibFile -Leaf) -eq "ai-memory-hook.ps1")) "lib path captured"

# 2. An undelivered event lands in <data>/hook-spool with the shared name
#    shape and entry fields.
Write-AiMemorySpoolEvent -Url $RefusedUrl -Body '{"e":"outage"}'
$dir = Get-AiMemorySpoolDir
$files = @(Get-ChildItem -LiteralPath $dir -Filter "*.json" -File)
Assert-True ($files.Count -eq 1) "one entry written"
Assert-True ($files[0].Name -match '^[0-9]{13}-[0-9]+-[0-9a-f]{16}\.json$') "entry name is <ms>-<pid>-<seq>"
$bytes = [IO.File]::ReadAllBytes($files[0].FullName)
Assert-True ($bytes.Length -gt 1 -and $bytes[0] -ne 0xEF) "entry has no UTF-8 BOM"
$entry = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
Assert-True ($entry.url -eq $RefusedUrl) "url round-trips"
Assert-True ($entry.body -eq '{"e":"outage"}') "body round-trips"
Assert-True ($entry.created_ms -ge 1000000000000) "created_ms is unix milliseconds"
Assert-True ($entry.auth_mode -eq "none") "no token means auth_mode none"
Assert-True ($null -eq $entry.token) "no token field when auth_mode is none"
Assert-True ($entry.attempts -eq 0) "attempts starts at 0"

# 3. The auth token rides the entry when set.
$env:AI_MEMORY_AUTH_TOKEN = "probe-bearer"
Write-AiMemorySpoolEvent -Url $RefusedUrl -Body '{"e":"auth"}'
$tokenEntry = Get-ChildItem -LiteralPath $dir -Filter "*.json" -File | Sort-Object Name | Select-Object -Last 1
$tokenParsed = [IO.File]::ReadAllText($tokenEntry.FullName) | ConvertFrom-Json
Assert-True ($tokenParsed.auth_mode -eq "static") "token entry is static auth"
Assert-True ($tokenParsed.token -eq "probe-bearer") "token round-trips"
Remove-Item Env:\AI_MEMORY_AUTH_TOKEN -ErrorAction SilentlyContinue

# 4. Two entries in the same process get distinct, ordered names.
$names = @(Get-ChildItem -LiteralPath $dir -Filter "*.json" -File | Sort-Object Name | ForEach-Object { $_.Name })
Assert-True ($names.Count -eq 2 -and $names[0] -cne $names[1]) "entry names are unique per write"

# 5. A drain pass against a refused connection keeps every entry (the
#    000/5xx "stop the pass, keep the remainder" semantics).
Invoke-AiMemoryDrainSpool -Max 8
$kept = @(Get-ChildItem -LiteralPath $dir -Filter "*.json" -File)
Assert-True ($kept.Count -eq 2) "refused connection keeps the backlog"

# 6. A missing spool directory is a no-op, not an error.
Remove-Item -Recurse -Force (Join-Path $root "data")
Invoke-AiMemoryDrainSpool -Max 8

Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
Write-Output "spool ps behavioral probe: ok checks=15"
exit 0
