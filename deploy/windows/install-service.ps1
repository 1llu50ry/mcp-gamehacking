# Install mcp-reverse as a Windows service using NSSM.
#
#   .\deploy\windows\install-service.ps1 -Install  [-Port 7777] [-Token <secret>]
#   .\deploy\windows\install-service.ps1 -Uninstall
#   .\deploy\windows\install-service.ps1 -Status
#
# Requires NSSM on PATH. Install with:  winget install nssm
# or:  choco install nssm

param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [int]$Port = 7777,
  [string]$Token = "",
  [string]$FsAllow = "C:\samples;C:\reverse-projects",
  [string]$ServiceName = "mcp-reverse"
)

$ErrorActionPreference = "Stop"
$Here = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Require-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal $id
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run from an elevated PowerShell."
  }
}

function Require-Nssm {
  $n = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if (-not $n) { throw "nssm not on PATH. Install with:  winget install nssm" }
  return $n.Source
}

if ($Status) {
  sc.exe query $ServiceName; exit 0
}

if ($Uninstall) {
  Require-Admin
  $nssm = Require-Nssm
  & $nssm stop   $ServiceName confirm 2>$null
  & $nssm remove $ServiceName confirm
  Write-Host "✓ removed service $ServiceName"
  exit 0
}

if ($Install) {
  Require-Admin
  $nssm = Require-Nssm
  $node = (Get-Command node.exe).Source
  $entry = Join-Path $Here "dist\index.js"
  if (-not (Test-Path $entry)) { throw "build first: npm run build" }

  & $nssm install $ServiceName $node $entry
  & $nssm set $ServiceName AppDirectory $Here
  & $nssm set $ServiceName AppEnvironmentExtra @(
    "MCP_TRANSPORT=http",
    "MCP_HTTP_HOST=127.0.0.1",
    "MCP_HTTP_PORT=$Port",
    "MCP_AUTH_TOKEN=$Token",
    "MCP_FS_ALLOW=$FsAllow",
    "MCP_RATE_LIMIT_PER_USER=1",
    "MCP_RATE_LIMIT_PER_USER_SEC=30",
    "NODE_ENV=production"
  )
  & $nssm set $ServiceName Start SERVICE_AUTO_START
  & $nssm set $ServiceName AppStdout "$Here\logs\service.out.log"
  & $nssm set $ServiceName AppStderr "$Here\logs\service.err.log"
  & $nssm set $ServiceName AppRotateFiles 1
  & $nssm set $ServiceName AppRotateBytes 10485760  # 10 MiB

  New-Item -ItemType Directory -Path (Join-Path $Here "logs") -Force | Out-Null
  & $nssm start $ServiceName
  Write-Host "✓ installed. http://127.0.0.1:$Port/mcp (healthz: /healthz, dashboard: /dashboard)"
  exit 0
}

Write-Host "Pass -Install, -Uninstall, or -Status. See the file's header for details."
