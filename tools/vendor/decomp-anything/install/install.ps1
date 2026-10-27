# decomp.anything installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.ps1 | iex
#   (or from a checkout: powershell -ExecutionPolicy Bypass -File install\install.ps1)
#
# decomp.anything is a Linux program (the old compilers it runs are), so on Windows it gets its own small Linux: a WSL 2
# distribution called decomp-wtf, the same Linux as its Docker image for servers. What this does, and nothing else:
#   1. makes sure WSL 2 is there (the first time Windows asks for permission, and may want a restart)
#   2. makes the decomp-wtf distribution from Debian's official WSL image (checksum-verified) and prepares it
#   3. installs decomp.anything in it (open source, MIT) with uv, with the free compilers and tools
#   4. puts a `decomp` command on Windows, adds decomp.anything to the Start menu and your desktop, and opens it
#
# Your projects live in it: \\wsl.localhost\decomp-wtf\home\decomp\Decomp. Nothing is sent to decomp.anything.
# Uninstall: decomp uninstall
#
# Testing a branch:  $env:DECOMP_BRANCH = "<name>"; irm https://raw.githubusercontent.com/giveen/decomp.anything/<name>/install/install.ps1 | iex
# From a checkout:   powershell -ExecutionPolicy Bypass -File install\install.ps1   (installs that checkout)

# Everything runs in its own block: `irm | iex` runs a script in your PowerShell session, and its settings shouldn't
# stay behind there.
& {
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Windows PowerShell downloads many times slower while drawing a progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Version = "0.11.0"
$Repo = "giveen/decomp.anything"
$Distro = "decomp-wtf"
$Wsl = Join-Path $env:SystemRoot "System32\wsl.exe"
# Say who's downloading. salsa.debian.org (Debian's WSL image) answers browser-like agents, as Windows PowerShell's
# default one is, with an anti-bot challenge page instead of the file.
$UA = "decomp.anything-installer/$Version (PowerShell)"
$Base = Join-Path $env:LOCALAPPDATA "decomp.anything"
$Bin = Join-Path $Base "bin"
$oldUtf8 = $env:WSL_UTF8
$env:WSL_UTF8 = "1"  # wsl.exe answers in UTF-16 otherwise

function Step($text) { Write-Host "> " -ForegroundColor Green -NoNewline; Write-Host $text }

# Programs say whether they worked with their exit code. Windows PowerShell turns what a program writes to stderr
# into errors, and with "Stop" a harmless note would end the install: run them with "Continue" and check the exit
# code instead.
function Run([scriptblock]$Command, [string]$Failure = "", [switch]$Quiet) {
    $ErrorActionPreference = "Continue"
    if ($Quiet) { & $Command *> $null } else { & $Command }
    if ($Failure -and $LASTEXITCODE -ne 0) { throw "$Failure (exit code $LASTEXITCODE)" }
}

# Linux reads shell scripts with LF line ends (a checkout made by Git for Windows may have CRLF)
function Save-Lf([string]$Text, [string]$Path) {
    [IO.File]::WriteAllText($Path, $Text.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

function To-Wsl([string]$Path) {
    $full = (Resolve-Path $Path).Path
    if ($full -match '^([A-Za-z]):\\?(.*)$') { return "/mnt/" + $Matches[1].ToLower() + "/" + ($Matches[2] -replace '\\', '/') }
    throw "decomp.anything's Linux can't reach $full (use a folder on a drive, like C:\...)"
}

function Distros {
    $list = Run { & $Wsl --list --quiet }
    return @($list | ForEach-Object { ("$_" -replace "`0", "").Trim() } | Where-Object { $_ })
}

try {
Write-Host "decomp.anything setup" -ForegroundColor White

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
    throw "decomp.anything needs a 64-bit Intel or AMD Windows for now (the old compilers are x86 programs)"
}

# ---------------------------------------------------------------------------- where decomp.anything comes from
# Run from a checkout (install\install.ps1 in the repository): that checkout. Else $env:DECOMP_SOURCE,
# $env:DECOMP_BRANCH (a branch on GitHub), or a branch on GitHub by default.
$checkout = $null
if ($PSScriptRoot) {
    $root = Split-Path $PSScriptRoot -Parent
    $py = Join-Path $root "pyproject.toml"
    if ((Test-Path $py) -and (Select-String -Path $py -Pattern '^name = "decompnet"' -Quiet)) { $checkout = $root }
}
$source = if ($env:DECOMP_SOURCE) { $env:DECOMP_SOURCE } elseif ($env:DECOMP_BRANCH) { "branch:$($env:DECOMP_BRANCH)" } elseif ($checkout) { $checkout } else { "branch:main" }
$linuxSource = if ($source -eq "release" -or $source.StartsWith("branch:")) { $source } else { To-Wsl $source }
$web = if ($source.StartsWith("branch:")) { "https://raw.githubusercontent.com/$Repo/$($source.Substring(7))/install" } else { "https://raw.githubusercontent.com/$Repo/main/install" }

# the Linux side's scripts, next to this one in a checkout or from the same place as this one
$tmp = Join-Path $env:TEMP ("decomp-wtf-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
foreach ($f in @("linux-base.sh", "install.sh", "decomp.ico")) {
    $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $f } else { $null }
    $dest = Join-Path $tmp $f
    if ($local -and (Test-Path $local)) { Copy-Item $local $dest }
    else {
        try { Invoke-WebRequest -UseBasicParsing -UserAgent $UA -Uri "$web/$f" -OutFile $dest }
        catch { throw "couldn't download $f from $web" }
    }
    if ($f.EndsWith(".sh")) { Save-Lf ([IO.File]::ReadAllText($dest)) $dest }
}
Save-Lf ("#!/bin/sh`nexport DECOMP_SOURCE=`"`$(cat ./source.txt)`"`nexec bash ./install.sh --no-start`n") (Join-Path $tmp "run-install.sh")
Save-Lf $linuxSource (Join-Path $tmp "source.txt")

# ---------------------------------------------------------------------------- WSL 2
Run { & $Wsl --version } -Quiet
if ($LASTEXITCODE -ne 0) {
    Step "turning on WSL 2, Windows' own Linux support (Windows asks for permission)"
    $p = Start-Process -FilePath $Wsl -ArgumentList "--install", "--no-distribution" -Verb RunAs -Wait -PassThru
    Run { & $Wsl --version } -Quiet
    if ($LASTEXITCODE -ne 0) {
        if ($p.ExitCode -ne 0) { throw "turning on WSL 2 didn't work (exit code $($p.ExitCode)). Run 'wsl --install --no-distribution' in an administrator PowerShell, restart Windows, then run this installer again." }
        Write-Host ""
        Write-Host "WSL 2 is turned on. Restart Windows to finish, then run this installer again." -ForegroundColor Yellow
        return
    }
}
Step ("WSL " + (((Run { & $Wsl --version }) | Select-Object -First 1) -replace "`0", "" -replace '^\D*', ''))

# ---------------------------------------------------------------------------- decomp.anything's Linux
if ((Distros) -notcontains $Distro) {
    Step "making decomp.anything's Linux (Debian, from Microsoft's list of WSL distributions)"
    New-Item -ItemType Directory -Force -Path $Base | Out-Null
    $made = $false
    try {
        $info = Invoke-RestMethod -UseBasicParsing -UserAgent $UA "https://raw.githubusercontent.com/microsoft/WSL/master/distributions/DistributionInfo.json"
        $debian = @($info.ModernDistributions.Debian) | Where-Object { $_.Name -eq "Debian" } | Select-Object -First 1
        if ($debian -and $debian.Amd64Url.Url) {
            $image = Join-Path $Base "debian.tar.gz"
            Invoke-WebRequest -UseBasicParsing -UserAgent $UA -Uri $debian.Amd64Url.Url -OutFile $image
            $sum = (Get-FileHash $image -Algorithm SHA256).Hash
            if ($sum -eq $debian.Amd64Url.Sha256) {
                Run { & $Wsl --import $Distro (Join-Path $Base "wsl") $image --version 2 }
                $made = $LASTEXITCODE -eq 0
            } else {
                Write-Host "  the downloaded Debian image isn't the one Microsoft lists (sha256 $sum): using WSL's own download instead"
            }
            Remove-Item $image -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Host "  couldn't get Debian's WSL image ($($_.Exception.Message)): using WSL's own download instead"
    }
    if (-not $made) {  # WSL's own way (WSL 2.4 and later)
        Run { & $Wsl --install Debian --name $Distro --location (Join-Path $Base "wsl") --no-launch }
        $made = (Distros) -contains $Distro
    }
    if (-not $made) {
        throw "WSL couldn't make decomp.anything's Linux. WSL 2 needs virtualization: check that it's on in your PC's BIOS/UEFI and that Windows' 'Virtual Machine Platform' feature is on, then run this again."
    }
}
Step "preparing decomp.anything's Linux (system packages, a few minutes the first time)"
Run { & $Wsl -d $Distro -u root --cd $tmp --exec sh ./linux-base.sh wsl } "preparing decomp.anything's Linux failed"
Run { & $Wsl --terminate $Distro } -Quiet  # its settings (user, PATH) apply from the next start

# a decomp.anything that's still running in it: stopped, so the new version takes over
Run { & $Wsl -d $Distro -u decomp --cd "~" --exec /usr/local/bin/decomp stop } -Quiet

$what = if ($source -eq "release") { "decomp.anything $Version" } elseif ($source.StartsWith("branch:")) { "the $($source.Substring(7)) branch" } else { $source }
Step "installing $what in it"
Run { & $Wsl -d $Distro -u decomp --cd $tmp --exec sh ./run-install.sh } "installing decomp.anything failed"

# ---------------------------------------------------------------------------- the old Windows-native decomp.anything
# decomp.anything before 0.10 ran on Windows itself (uv tool decompnet): stop it and take its place. Its projects stay
# where they are (%USERPROFILE%\Decomp).
$uvBin = Join-Path $env:USERPROFILE ".local\bin"
$uv = if (Test-Path (Join-Path $uvBin "uv.exe")) { Join-Path $uvBin "uv.exe" } else { (Get-Command uv -ErrorAction SilentlyContinue).Source }
if ($uv -and (Test-Path (Join-Path $uvBin "decomp.exe"))) {
    $state = Join-Path $env:USERPROFILE "Decomp\.decomp\server.json"
    if (Test-Path $state) {
        try {
            $app = Get-Content -Raw $state | ConvertFrom-Json
            $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession  # Windows PowerShell drops a Cookie header
            $session.Cookies.Add((New-Object System.Net.Cookie("decomp_live", $app.secret, "/", "127.0.0.1")))
            Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($app.port)/api/quit" -Body "{}" -ContentType "application/json" `
                -WebSession $session -Headers @{ "X-Decomp" = "1" } -TimeoutSec 10 | Out-Null
            Wait-Process -Id $app.pid -Timeout 20 -ErrorAction SilentlyContinue
        } catch { }  # not running
    }
    $toolEnv = Join-Path ((Run { & $uv tool dir }) | Out-String).Trim() "decompnet"
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith("$toolEnv\", [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Run { & $uv tool uninstall decompnet } -Quiet
    Step "removed the previous decomp.anything that ran on Windows itself (its projects stay in $env:USERPROFILE\Decomp)"
}

# ---------------------------------------------------------------------------- `decomp` on Windows
New-Item -ItemType Directory -Force -Path $Bin | Out-Null
Copy-Item (Join-Path $tmp "decomp.ico") (Join-Path $Bin "decomp.ico") -Force
$cmd = @'
@echo off
rem decomp.anything runs in WSL 2 (the decomp-wtf distribution); this is its decomp command on Windows.
rem   decomp            decomp.anything in this window (opens your browser)   decomp shell      a terminal inside
rem   decomp connect    give your AI agents decomp.anything's tools           decomp update     the newest decomp.anything
rem   decomp uninstall  remove it
if /i "%~1"=="shell" goto shell
if /i "%~1"=="connect" goto connect
if /i "%~1"=="uninstall" goto uninstall
"%SystemRoot%\System32\wsl.exe" -d decomp-wtf --cd ~ --exec /usr/local/bin/decomp %*
exit /b %ERRORLEVEL%
:shell
"%SystemRoot%\System32\wsl.exe" -d decomp-wtf --cd ~
exit /b %ERRORLEVEL%
:connect
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0decomp-connect.ps1"
exit /b %ERRORLEVEL%
:uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0decomp-uninstall.ps1"
exit /b %ERRORLEVEL%
'@
[IO.File]::WriteAllText((Join-Path $Bin "decomp.cmd"), $cmd.Replace("`r`n", "`n").Replace("`n", "`r`n"), (New-Object Text.ASCIIEncoding))

# Agents on Windows reach decomp.anything through wsl.exe; WSL doesn't pass Windows' environment through, so the name
# they show up with in the app goes in as --name.
$connect = @'
# decomp connect: give the AI agents on this computer decomp.anything's tools (decomp.anything runs in WSL 2: decomp-wtf)
$ErrorActionPreference = "Continue"
$wsl = Join-Path $env:SystemRoot "System32\wsl.exe"
function Bridge($name) { return @($wsl, "-d", "decomp-wtf", "--cd", "~", "--exec", "/usr/local/bin/decomp", "mcp", "--name", $name) }
# the program itself (.exe, or npm's .cmd), never npm's .ps1: PowerShell would read the "--" below as its own
function Find($c) { $f = Get-Command $c -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($f) { return $f.Source } }
$n = 0
if ($claude = Find "claude") {
    $n++
    & $claude @("mcp", "remove", "-s", "user", "decomp") *> $null
    & $claude @(@("mcp", "add", "-s", "user", "decomp", "--") + (Bridge "claude-code")) *> $null
    if ($LASTEXITCODE -eq 0) { "Claude Code: connected" } else { "Claude Code: couldn't connect (exit code $LASTEXITCODE)" }
}
if ($codex = Find "codex") {
    $n++
    & $codex @("mcp", "remove", "decomp") *> $null
    & $codex @(@("mcp", "add", "decomp", "--") + (Bridge "codex")) *> $null
    if ($LASTEXITCODE -eq 0) { "Codex: connected" } else { "Codex: couldn't connect (exit code $LASTEXITCODE)" }
}
if ($agy = Find "agy") {
    $n++
    & $agy @(@("mcp", "add", "decomp", "--") + (Bridge "antigravity")) *> $null
    if ($LASTEXITCODE -eq 0) { "Antigravity CLI: connected" } else { "Antigravity CLI: couldn't connect (exit code $LASTEXITCODE)" }
}
if (Find "opencode") {
    $n++
    $dir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $env:USERPROFILE ".config\opencode" }
    $file = Join-Path $dir "opencode.json"
    try {
        $cfg = if (Test-Path $file) { Get-Content -Raw $file | ConvertFrom-Json } else { [pscustomobject]@{ '$schema' = "https://opencode.ai/config.json" } }
        if (-not $cfg.mcp) { $cfg | Add-Member -NotePropertyName mcp -NotePropertyValue ([pscustomobject]@{}) -Force }
        $cfg.mcp | Add-Member -NotePropertyName decomp -NotePropertyValue ([pscustomobject]@{ type = "local"; command = (Bridge "opencode"); enabled = $true }) -Force
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        [IO.File]::WriteAllText($file, ($cfg | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))
        "opencode: connected ($file)"
    } catch { "opencode: couldn't change $file ($_)" }
}
if ($n -eq 0) { "No agent CLI found here (Claude Code, Codex, Antigravity CLI, opencode). Install one, then run: decomp connect"; exit 1 }
'Now ask your agent, for example: "decompile my game at C:\Games\game.z64"'
'@
Save-Lf $connect (Join-Path $Bin "decomp-connect.ps1")

$uninstall = @'
# decomp uninstall: remove decomp.anything (its WSL distribution decomp-wtf, the decomp command, the shortcuts)
$ErrorActionPreference = "Continue"
$answer = Read-Host "Remove decomp.anything and its Linux, with every project in it (\\wsl.localhost\decomp-wtf\home\decomp\Decomp)? Type yes"
if ($answer -ne "yes") { "Nothing removed."; exit 1 }
& (Join-Path $env:SystemRoot "System32\wsl.exe") --unregister decomp-wtf
foreach ($d in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
    if ($d) { Remove-Item (Join-Path $d "decomp.anything.lnk") -ErrorAction SilentlyContinue }
}
$bin = Join-Path $env:LOCALAPPDATA "decomp.anything\bin"
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
$raw = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$key.SetValue("Path", (($raw -split ";") | Where-Object { $_ -and $_ -ne $bin }) -join ";", [Microsoft.Win32.RegistryValueKind]::ExpandString)
$key.Close()
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "timeout /t 2 >nul & rmdir /s /q `"$(Split-Path $bin -Parent)`"" -WindowStyle Hidden
"decomp.anything removed."
'@
Save-Lf $uninstall (Join-Path $Bin "decomp-uninstall.ps1")

# on PATH for new windows (the registry value as it is, %VARIABLES% kept) and for this one
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
$raw = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
if (($raw -split ";") -notcontains $Bin) {
    $key.SetValue("Path", ((@($raw -split ";" | Where-Object { $_ }) + $Bin) -join ";"), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    [Environment]::SetEnvironmentVariable("DECOMP_WTF_REFRESH", "1", "User")  # these two tell open programs that
    [Environment]::SetEnvironmentVariable("DECOMP_WTF_REFRESH", $null, "User")  # PATH changed (WM_SETTINGCHANGE)
}
$key.Close()
if (($env:Path -split ";") -notcontains $Bin) { $env:Path = "$Bin;$env:Path" }
Step "decomp is a command on Windows now ($Bin)"

# Start menu and desktop (a desktop may be in OneDrive: Windows says where)
$shell = New-Object -ComObject WScript.Shell
foreach ($d in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
    if ($d -and (Test-Path $d)) {
        $lnk = $shell.CreateShortcut((Join-Path $d "decomp.anything.lnk"))
        $lnk.TargetPath = $Wsl
        $lnk.Arguments = "-d $Distro --cd ~ --exec /usr/local/bin/decomp"
        $lnk.WindowStyle = 7
        $lnk.IconLocation = (Join-Path $Bin "decomp.ico")
        $lnk.Description = "decomp.anything"
        $lnk.Save()
    }
}
Step "added decomp.anything to the Start menu and your desktop"

# Your AI agents with decomp.anything's tools: only when someone is there to say yes (it changes their configs)
$agents = @("claude", "codex", "agy", "opencode") | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
if ($agents -and [Environment]::UserInteractive) {
    try { $yes = Read-Host "Give your AI agents ($($agents -join ', ')) decomp.anything's tools, so you can just ask them to decompile a game? [Y/n]" } catch { $yes = "n" }
    if ($yes -eq "" -or $yes -match '^[Yy]') {
        Run { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Bin "decomp-connect.ps1") } | ForEach-Object { "  $_" }
    }
}

Step "starting decomp.anything"
Start-Process -FilePath $Wsl -ArgumentList "-d", $Distro, "--cd", "~", "--exec", "/usr/local/bin/decomp" -WindowStyle Minimized

Write-Host ""
Write-Host "Done. decomp.anything is opening in your browser." -ForegroundColor White
Write-Host "  Open it again any time: decomp.anything in the Start menu or on your desktop (or type decomp)."
Write-Host "  It runs in a small minimized window; closing that window stops it."
Write-Host "  From your AI agent: run 'decomp connect' once, then ask it to decompile your game."
Write-Host "  Your projects: \\wsl.localhost\$Distro\home\decomp\Decomp"
}
finally {
    $env:WSL_UTF8 = $oldUtf8
    if ($tmp -and (Test-Path $tmp)) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
}
