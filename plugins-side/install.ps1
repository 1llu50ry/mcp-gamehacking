# mcp-gamehacking :: plugins-side installer (Windows)
# ---------------------------------------------------------------
# Auto-detects IDA Pro, Ghidra, Binary Ninja, ReClass.NET, dnSpy /
# dnSpyEx, ILSpy, x64dbg, Cheat Engine and drops the right plugin
# file into each one's conventional plugins directory.
#
# Dry-run first; nothing is copied until you pass -Apply.
#
# Examples:
#   .\install.ps1                     # dry run, prints what it would do
#   .\install.ps1 -Apply              # install everything it detects
#   .\install.ps1 -Apply -Only ida    # only install the IDA plugin
#   .\install.ps1 -Only ghidra,binja  # dry-run specific hosts
#
# Set env vars to override the search path for a host:
#   $env:IDA_PATH   = "C:\IDA 9.0"
#   $env:GHIDRA_USER = "$env:USERPROFILE\.ghidra\.ghidra_11.1.2_PUBLIC"
#   $env:BINJA_PATH = "$env:APPDATA\Binary Ninja"
#   $env:RECLASS_PATH = "C:\Tools\ReClass.NET"
#   $env:DNSPY_PATH = "C:\dnSpyEx"
#   $env:ILSPY_PATH = "C:\Program Files\ILSpy"
#   $env:X64DBG_PATH = "C:\Tools\x64dbg\release"
#   $env:CE_PATH   = "C:\Program Files\Cheat Engine 7.5"

param(
  [switch]$Apply,
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Pick([string[]]$candidates) {
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}
function Copy-Plugin($src, $dstDir, $hostName) {
  if (-not (Test-Path $src)) { Say "  SKIP (source missing): $src" "DarkYellow"; return }
  if (-not $Apply) { Say "  [dry] copy $src → $dstDir" "DarkCyan"; return }
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  $leaf = Split-Path -Leaf $src
  $target = Join-Path $dstDir $leaf
  Copy-Item -Path $src -Destination $target -Force -Recurse
  Say "  ✓ installed $hostName plugin to $target" "Green"
}

function Should($name) { if ($Only.Count -eq 0) { return $true } ; return ($Only -contains $name) }

# -------- IDA Pro --------
if (Should "ida") {
  Say "`n[ida] searching for IDA Pro install..." "Cyan"
  $idaRoot = Pick @(
    $env:IDA_PATH,
    "C:\Program Files\IDA Pro 9.0",
    "C:\Program Files\IDA Pro 8.4",
    "C:\Program Files\IDA Pro 8.3",
    "C:\Program Files (x86)\IDA 9.0",
    "C:\Program Files (x86)\IDA 8.4"
  )
  $idaUsr = Pick @(
    "$env:APPDATA\Hex-Rays\IDA Pro"
  )
  if (-not $idaUsr) { Say "  no IDAUSR found at %APPDATA%\Hex-Rays\IDA Pro — IDA creates it on first launch" "DarkYellow" }
  else {
    Say "  IDAUSR: $idaUsr"
    Copy-Plugin "$Here\ida-pro\mcp_bridge.py" "$idaUsr\plugins" "IDA"
  }
  if ($idaRoot) { Say "  (also detected IDA root: $idaRoot — plugin goes in IDAUSR, not root)" "DarkGray" }
}

# -------- Ghidra --------
if (Should "ghidra") {
  Say "`n[ghidra] searching for Ghidra user dir..." "Cyan"
  $ghidraCandidates = @()
  if ($env:GHIDRA_USER) { $ghidraCandidates += $env:GHIDRA_USER }
  $ghidraCandidates += Get-ChildItem -Path "$env:USERPROFILE\.ghidra" -Directory -ErrorAction SilentlyContinue |
                       Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
  $ghidraUser = $ghidraCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($ghidraUser) {
    Say "  Ghidra user: $ghidraUser"
    Copy-Plugin "$Here\ghidra\mcp_bridge.py" "$ghidraUser\scripts" "Ghidra"
  } else { Say "  no Ghidra user dir — set `$env:GHIDRA_USER" "DarkYellow" }
}

# -------- Binary Ninja --------
if (Should "binja") {
  Say "`n[binja] searching for Binary Ninja user dir..." "Cyan"
  $binja = Pick @(
    $env:BINJA_PATH,
    "$env:APPDATA\Binary Ninja"
  )
  if ($binja) {
    Say "  Binja user: $binja"
    Copy-Plugin "$Here\binaryninja\mcp_bridge.py" "$binja\plugins" "Binary Ninja"
  } else { Say "  no Binja user dir — set `$env:BINJA_PATH" "DarkYellow" }
}

# -------- Cheat Engine --------
if (Should "ce") {
  Say "`n[ce] searching for Cheat Engine..." "Cyan"
  $ce = Pick @(
    $env:CE_PATH,
    "C:\Program Files\Cheat Engine 7.5",
    "C:\Program Files\Cheat Engine 7.4",
    "C:\Program Files (x86)\Cheat Engine 7.5",
    "C:\Program Files (x86)\Cheat Engine 7.4"
  )
  if ($ce) {
    Say "  Cheat Engine: $ce"
    Copy-Plugin "$Here\cheat-engine\mcp_bridge.lua" "$ce\autorun" "Cheat Engine"
  } else { Say "  CE not found — set `$env:CE_PATH" "DarkYellow" }
}

# -------- ReClass.NET --------
if (Should "reclass") {
  Say "`n[reclass] searching for ReClass.NET..." "Cyan"
  $rc = Pick @($env:RECLASS_PATH)
  $rcDll = "$Here\reclass-net\bin\Release\net48\ReClassNET-MCP.dll"
  if ($rc) {
    Say "  ReClass.NET: $rc"
    if (Test-Path $rcDll) { Copy-Plugin $rcDll "$rc\Plugins" "ReClass.NET" }
    else { Say "  build the plugin first:  dotnet build $Here\reclass-net\ReClassNET-MCP.csproj /p:RECLASS_DIR=`"$rc`"" "DarkYellow" }
  } else { Say "  set `$env:RECLASS_PATH" "DarkYellow" }
}

# -------- dnSpy / dnSpyEx --------
if (Should "dnspy") {
  Say "`n[dnspy] searching for dnSpy / dnSpyEx..." "Cyan"
  $dn = Pick @($env:DNSPY_PATH)
  $dnDll = "$Here\dnspy\bin\Release\net8.0-windows\mcp_dnspy_bridge.dll"
  if ($dn) {
    Say "  dnSpy: $dn"
    if (Test-Path $dnDll) { Copy-Plugin $dnDll "$dn\Extensions\mcp-bridge" "dnSpy" }
    else { Say "  build:  dotnet build $Here\dnspy\mcp_dnspy_bridge.csproj /p:DNSPY_DIR=`"$dn`"" "DarkYellow" }
  } else { Say "  set `$env:DNSPY_PATH" "DarkYellow" }
}

# -------- ILSpy --------
if (Should "ilspy") {
  Say "`n[ilspy] searching for ILSpy..." "Cyan"
  $il = Pick @($env:ILSPY_PATH, "C:\Program Files\ILSpy")
  $ilDll = "$Here\ilspy\bin\Release\net8.0-windows\mcp_ilspy_bridge.dll"
  if ($il) {
    Say "  ILSpy: $il"
    if (Test-Path $ilDll) { Copy-Plugin $ilDll $il "ILSpy" }
    else { Say "  build:  dotnet build $Here\ilspy\mcp_ilspy_bridge.csproj /p:ILSPY_DIR=`"$il`"" "DarkYellow" }
  } else { Say "  set `$env:ILSPY_PATH" "DarkYellow" }
}

# -------- x64dbg --------
if (Should "x64dbg") {
  Say "`n[x64dbg] searching for x64dbg..." "Cyan"
  $x64 = Pick @(
    $env:X64DBG_PATH,
    "C:\Program Files\x64dbg\release",
    "C:\Tools\x64dbg\release"
  )
  if ($x64) {
    Say "  x64dbg: $x64"
    foreach ($bits in @("x64", "x32")) {
      $ext = if ($bits -eq "x64") { ".dp64" } else { ".dp32" }
      $built = "$Here\x64dbg\build-$bits\Release\mcp_bridge$ext"
      $dst = "$x64\$bits\plugins"
      if (Test-Path $built) { Copy-Plugin $built $dst "x64dbg ($bits)" }
      else { Say "  build $bits:  cmake -S $Here\x64dbg -B $Here\x64dbg\build-$bits -A $(if($bits -eq 'x64'){'x64'}else{'Win32'}) -DX64DBG_SDK=`"$x64\$bits\plugins\sdk`"" "DarkYellow" }
    }
  } else { Say "  set `$env:X64DBG_PATH" "DarkYellow" }
}

Say ""
if (-not $Apply) { Say "This was a dry run. Pass -Apply to actually copy files." "Yellow" }
else { Say "Done." "Green" }
