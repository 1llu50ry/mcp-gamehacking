# Build script for ReClassMCP plugin
param(
    [string]$Configuration = "Release",
    [string]$Platform = "x64"
)

$ErrorActionPreference = "Stop"

Write-Host "Building ReClassMCP Plugin..." -ForegroundColor Cyan
Write-Host "Configuration: $Configuration"
Write-Host "Platform: $Platform"

# Find MSBuild
$msbuildPath = $null

# Try vswhere first (Visual Studio 2017+)
$vswherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswherePath) {
    $vsPath = & $vswherePath -latest -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" | Select-Object -First 1
    if ($vsPath) {
        $msbuildPath = $vsPath
    }
}

# Try common locations
if (-not $msbuildPath) {
    $possiblePaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Professional\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\MSBuild\14.0\Bin\MSBuild.exe"
    )
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $msbuildPath = $path
            break
        }
    }
}

# Try PATH
if (-not $msbuildPath) {
    $msbuildCmd = Get-Command msbuild -ErrorAction SilentlyContinue
    if ($msbuildCmd) {
        $msbuildPath = $msbuildCmd.Source
    }
}

if (-not $msbuildPath) {
    Write-Host "ERROR: MSBuild not found. Please install Visual Studio or the Build Tools." -ForegroundColor Red
    Write-Host "Download from: https://visualstudio.microsoft.com/downloads/" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using MSBuild: $msbuildPath" -ForegroundColor Gray

# Create packages directory if it doesn't exist
$packagesDir = Join-Path $PSScriptRoot "packages"
if (-not (Test-Path $packagesDir)) {
    New-Item -ItemType Directory -Path $packagesDir -Force | Out-Null
}

# Download nuget.exe if not available
$nugetPath = Join-Path $PSScriptRoot "nuget.exe"
if (-not (Test-Path $nugetPath)) {
    $nugetCmd = Get-Command nuget -ErrorAction SilentlyContinue
    if ($nugetCmd) {
        $nugetPath = $nugetCmd.Source
    } else {
        Write-Host "`nDownloading nuget.exe..." -ForegroundColor Yellow
        $nugetUrl = "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe"
        Invoke-WebRequest -Uri $nugetUrl -OutFile $nugetPath
    }
}

# Restore NuGet packages
Write-Host "`nRestoring NuGet packages..." -ForegroundColor Yellow
& $nugetPath restore "ReClassMCP.Plugin\packages.config" -PackagesDirectory $packagesDir

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to restore NuGet packages" -ForegroundColor Red
    exit 1
}

# Build NativeCore first (required by ReClass.NET)
Write-Host "`nBuilding NativeCore..." -ForegroundColor Yellow
& $msbuildPath "ReClass.NET\NativeCore\Windows\NativeCore.vcxproj" `
    /p:Configuration=$Configuration `
    /p:Platform=$Platform `
    /p:PlatformToolset=v145 `
    /t:Build `
    /v:minimal

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build NativeCore" -ForegroundColor Red
    exit 1
}

# Build ReClass.NET (required for reference)
Write-Host "`nBuilding ReClass.NET..." -ForegroundColor Yellow
& $msbuildPath "ReClass.NET\ReClass.NET\ReClass.NET.csproj" `
    /p:Configuration=$Configuration `
    /p:Platform=$Platform `
    /t:Build `
    /v:minimal `
    /restore

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build ReClass.NET" -ForegroundColor Red
    exit 1
}

# Copy NativeCore.dll to output
$nativeCoreSrc = "ReClass.NET\NativeCore\Windows\bin\$Configuration\$Platform\NativeCore.dll"
$nativeCoreDst = "ReClass.NET\ReClass.NET\bin\$Configuration\$Platform\"
if (Test-Path $nativeCoreSrc) {
    Copy-Item $nativeCoreSrc $nativeCoreDst -Force
    Write-Host "Copied NativeCore.dll to output" -ForegroundColor Gray
}

# Build the plugin
Write-Host "`nBuilding ReClassMCP.Plugin..." -ForegroundColor Yellow
& $msbuildPath "ReClassMCP.Plugin\ReClassMCP.Plugin.csproj" `
    /p:Configuration=$Configuration `
    /p:Platform=$Platform `
    /t:Build `
    /v:minimal

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build ReClassMCP.Plugin" -ForegroundColor Red
    exit 1
}

$outputPath = "ReClassMCP.Plugin\bin\$Platform\$Configuration"
Write-Host "`nBuild successful!" -ForegroundColor Green
Write-Host "Output: $outputPath\ReClassMCP.Plugin.dll"

# Copy to ReClass.NET plugins folder if it exists
$reclassPluginsPath = "ReClass.NET\ReClass.NET\bin\$Platform\$Configuration\Plugins"
if (Test-Path (Split-Path $reclassPluginsPath)) {
    if (-not (Test-Path $reclassPluginsPath)) {
        New-Item -ItemType Directory -Path $reclassPluginsPath -Force | Out-Null
    }

    Copy-Item "$outputPath\ReClassMCP.Plugin.dll" $reclassPluginsPath -Force

    # Copy Newtonsoft.Json if it exists in packages
    $jsonDll = Get-ChildItem -Path $packagesDir -Recurse -Filter "Newtonsoft.Json.dll" |
               Where-Object { $_.FullName -like "*net45*" } |
               Select-Object -First 1
    if ($jsonDll) {
        Copy-Item $jsonDll.FullName $reclassPluginsPath -Force
    }

    Write-Host "Copied to: $reclassPluginsPath" -ForegroundColor Green
}

Write-Host "`nDone!" -ForegroundColor Cyan
