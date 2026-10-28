# install.ps1 against crafted releases served over local HTTP: a good release
# installs (under PowerShell 7 and Windows PowerShell 5.1), also while another
# process holds the unpacked binary open, and a checksum mismatch, an archive
# entry escaping the install dir, and an existing install are each refused
# with nothing written. Outside GitHub Actions the user PATH is never touched
# (AI_MEMORY_NO_MODIFY_PATH=1); on a runner, one case lets install.ps1 add to
# it and restores the value it found. Needs python on PATH for the HTTP server.
#
# Usage: pwsh -NoProfile -File tests/install_ps1.ps1 -Binary target\debug\ai-memory.exe

param([Parameter(Mandatory = $true)][string] $Binary)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'install.ps1'
$asset = 'ai-memory-windows-x86_64.zip'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ai-memory-install-ps1-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fail([string] $message) { throw "install_ps1: $message" }

# publish <name> [-Evil] [-BadSum]: a release dir serving latest/download/<asset>.
function Publish([string] $name, [switch] $Evil, [switch] $BadSum) {
    $dir = Join-Path $tmp "$name\latest\download"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $zip = Join-Path $dir $asset
    $archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Resolve-Path $Binary), 'ai-memory.exe') | Out-Null
        $hook = $archive.CreateEntry('hooks/_lib.sh')
        $writer = New-Object IO.StreamWriter($hook.Open())
        $writer.Write('echo hook'); $writer.Dispose()
        if ($Evil) {
            $escape = $archive.CreateEntry('../escape.txt')
            $writer = New-Object IO.StreamWriter($escape.Open())
            $writer.Write('outside'); $writer.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($BadSum) { $hash = '0' * 64 }
    "$hash  $asset`n" | Out-File -Encoding ascii -NoNewline "$zip.sha256"
    return (Join-Path $tmp $name)
}

$port = Get-Random -Minimum 20000 -Maximum 60000
$server = Start-Process python -ArgumentList @('-m', 'http.server', "$port", '--bind', '127.0.0.1', '--directory', $tmp) -PassThru -WindowStyle Hidden
try {
    $deadline = (Get-Date).AddSeconds(20)
    while ($true) {
        try { (New-Object Net.Sockets.TcpClient('127.0.0.1', $port)).Dispose(); break } catch { }
        if ((Get-Date) -gt $deadline) { Fail 'the local HTTP server did not start' }
        Start-Sleep -Milliseconds 200
    }

    # install <shell> <release> <dest> [-ModifyPath]: run install.ps1 with the
    # test env, leaving the user PATH alone unless -ModifyPath; returns the exit code.
    function Install([string] $shell, [string] $release, [string] $dest, [string] $log, [switch] $ModifyPath) {
        $env:AI_MEMORY_RELEASE_BASE_URL = "http://127.0.0.1:$port/$release"
        $env:AI_MEMORY_INSTALL_DIR = $dest
        if (-not $ModifyPath) { $env:AI_MEMORY_NO_MODIFY_PATH = '1' }
        try {
            & $shell -NoProfile -ExecutionPolicy Bypass -File $script *> $log
            return $LASTEXITCODE
        } finally {
            Remove-Item Env:AI_MEMORY_RELEASE_BASE_URL, Env:AI_MEMORY_INSTALL_DIR, Env:AI_MEMORY_NO_MODIFY_PATH -ErrorAction SilentlyContinue
        }
    }

    Publish good | Out-Null
    foreach ($shell in @('pwsh', 'powershell')) {
        $dest = Join-Path $tmp "inst-$shell\ai-memory"
        $log = Join-Path $tmp "good-$shell.log"
        if ((Install $shell 'good' $dest $log) -ne 0) { Fail "$shell refused a good release: $(Get-Content $log -Raw)" }
        if (-not (Test-Path (Join-Path $dest 'ai-memory.exe'))) { Fail "$shell did not unpack ai-memory.exe" }
        if (-not (Test-Path (Join-Path $dest 'hooks\_lib.sh'))) { Fail "$shell did not unpack hooks" }
        if ((Get-Content $log -Raw) -notmatch 'next: ') { Fail "$shell printed no next step: $(Get-Content $log -Raw)" }

        # A second run finds the install and points to `ai-memory upgrade`.
        $again = Join-Path $tmp "again-$shell.log"
        if ((Install $shell 'good' $dest $again) -eq 0) { Fail "$shell reinstalled over an existing install" }
        if ((Get-Content $again -Raw) -notmatch 'ai-memory upgrade') { Fail "$shell did not point to upgrade: $(Get-Content $again -Raw)" }
    }

    # An antivirus scan of the unpacked binary holds it open, sharing read and
    # write but not delete access, so Windows refuses to rename or delete it
    # (#1480). The install must still go through. TMP points at a directory of
    # its own, so the watcher sees only the staged release.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

public static class StagedBinaryScan
{
    static readonly List<FileStream> held = new List<FileStream>();
    static FileSystemWatcher watcher;
    static volatile bool stopped;

    public static void Start(string root)
    {
        watcher = new FileSystemWatcher(root, "ai-memory.exe");
        watcher.IncludeSubdirectories = true;
        watcher.Created += (sender, e) => Hold(e.FullPath);
        watcher.EnableRaisingEvents = true;
    }

    // Retried: the unpacker may still be writing the file without sharing it.
    static void Hold(string path)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(60);
        while (!stopped && DateTime.UtcNow < deadline)
        {
            try
            {
                FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                lock (held)
                {
                    if (stopped) { stream.Dispose(); } else { held.Add(stream); }
                }
                return;
            }
            catch (Exception)
            {
                Thread.Sleep(1);
            }
        }
    }

    public static int Count
    {
        get { lock (held) { return held.Count; } }
    }

    public static void Stop()
    {
        stopped = true;
        watcher.Dispose();
        lock (held)
        {
            foreach (FileStream stream in held) { stream.Dispose(); }
            held.Clear();
        }
    }
}
'@
    $scanTemp = Join-Path $tmp 'scan-temp'
    New-Item -ItemType Directory -Path $scanTemp | Out-Null
    $savedTmp, $savedTemp = $env:TMP, $env:TEMP
    [StagedBinaryScan]::Start($scanTemp)
    try {
        $env:TMP = $scanTemp
        $env:TEMP = $scanTemp
        foreach ($shell in @('pwsh', 'powershell')) {
            $dest = Join-Path $tmp "inst-scan-$shell\ai-memory"
            $log = Join-Path $tmp "scan-$shell.log"
            if ((Install $shell 'good' $dest $log) -ne 0) { Fail "$shell failed while the unpacked binary was held open: $(Get-Content $log -Raw)" }
            if (-not (Test-Path (Join-Path $dest 'ai-memory.exe'))) { Fail "$shell did not install ai-memory.exe while it was held open" }
            if (-not (Test-Path (Join-Path $dest 'hooks\_lib.sh'))) { Fail "$shell did not install hooks while ai-memory.exe was held open" }
        }
        if ([StagedBinaryScan]::Count -lt 2) { Fail "the unpacked binary was held open in $([StagedBinaryScan]::Count) of 2 installs" }
    } finally {
        $env:TMP = $savedTmp
        $env:TEMP = $savedTemp
        [StagedBinaryScan]::Stop()
    }

    # Adding the install dir must leave the rest of the user PATH as it was:
    # still REG_EXPAND_SZ, with %VAR% entries unexpanded (#1509). This rewrites
    # the real HKCU\Environment Path, so it runs only on a GitHub Actions
    # runner, and the value it found is put back.
    if ($env:GITHUB_ACTIONS -eq 'true') {
        $environment = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
        $saved = $environment.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
        $savedKind = if ($null -ne $saved) { $environment.GetValueKind('Path') }
        $probe = '%USERPROFILE%\ai-memory-path-probe'
        try {
            $environment.SetValue('Path', (@($probe, $saved) | Where-Object { $_ }) -join ';', 'ExpandString')
            foreach ($shell in @('pwsh', 'powershell')) {
                $dest = Join-Path $tmp "inst-path-$shell\ai-memory"
                $log = Join-Path $tmp "path-$shell.log"
                if ((Install $shell 'good' $dest $log -ModifyPath) -ne 0) { Fail "$shell failed to install with a PATH update: $(Get-Content $log -Raw)" }
                $kind = $environment.GetValueKind('Path')
                $entries = $environment.GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';'
                if ($kind -ne 'ExpandString') { Fail "$shell stored the user PATH as $kind" }
                if ($entries -notcontains $probe) { Fail "$shell expanded $probe in the user PATH: $($entries -join ';')" }
                if ($entries -notcontains $dest) { Fail "$shell did not add $dest to the user PATH" }
            }
        } finally {
            if ($null -eq $saved) { $environment.DeleteValue('Path', $false) } else { $environment.SetValue('Path', $saved, $savedKind) }
            $environment.Dispose()
        }
    }

    Publish badsum -BadSum | Out-Null
    $dest = Join-Path $tmp 'inst-badsum\ai-memory'
    $log = Join-Path $tmp 'badsum.log'
    if ((Install 'pwsh' 'badsum' $dest $log) -eq 0) { Fail 'a checksum mismatch was installed' }
    if ((Get-Content $log -Raw) -notmatch 'checksum mismatch') { Fail "mismatch not explained: $(Get-Content $log -Raw)" }
    if (Test-Path $dest) { Fail 'a refused release was unpacked' }

    Publish evil -Evil | Out-Null
    $dest = Join-Path $tmp 'inst-evil\ai-memory'
    $log = Join-Path $tmp 'evil.log'
    if ((Install 'pwsh' 'evil' $dest $log) -eq 0) { Fail 'an archive with a .. entry was installed' }
    if ((Get-Content $log -Raw) -notmatch 'unsafe path') { Fail "unsafe entry not explained: $(Get-Content $log -Raw)" }
    if (Test-Path $dest) { Fail 'a refused release was unpacked' }
    if (Test-Path (Join-Path $tmp 'inst-evil\escape.txt')) { Fail 'the .. entry escaped' }

    Write-Host 'install.ps1 checks passed'
} finally {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
