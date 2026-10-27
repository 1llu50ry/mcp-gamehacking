"""Add decomp.wtf to the apps menu: a .desktop entry (Linux), an app bundle (macOS), a Start Menu
and desktop shortcut (Windows). Each just runs `decomp`, which opens the app in the browser."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from importlib import resources
from pathlib import Path


def _decomp_exe() -> str:
    found = shutil.which("decomp")
    if found:
        return found
    exe = Path(sys.argv[0]).resolve()
    return str(exe)


def install_launcher() -> str:
    exe = _decomp_exe()
    icon_svg = resources.files("decompnet.app").joinpath("static", "icon.svg").read_bytes()
    if sys.platform.startswith("linux"):
        icons = Path.home() / ".local" / "share" / "icons" / "hicolor" / "scalable" / "apps"
        icons.mkdir(parents=True, exist_ok=True)
        (icons / "decomp-wtf.svg").write_bytes(icon_svg)
        apps = Path.home() / ".local" / "share" / "applications"
        apps.mkdir(parents=True, exist_ok=True)
        entry = apps / "decomp-wtf.desktop"
        entry.write_text("[Desktop Entry]\nType=Application\nName=decomp.wtf\n"
                         "Comment=What The Function: your AI agent decompiles your games, byte for byte\n"
                         f"Exec=\"{exe}\"\nIcon=decomp-wtf\nTerminal=false\nCategories=Development;\n", encoding="utf-8")
        os.chmod(entry, 0o755)
        return f"added decomp.wtf to your apps menu ({entry})"
    if sys.platform == "darwin":
        app = Path.home() / "Applications" / "decomp.wtf.app"
        macos = app / "Contents" / "MacOS"
        macos.mkdir(parents=True, exist_ok=True)
        (app / "Contents" / "Info.plist").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'
            "<key>CFBundleName</key><string>decomp.wtf</string>"
            "<key>CFBundleIdentifier</key><string>wtf.decomp.app</string>"
            "<key>CFBundleExecutable</key><string>decomp-wtf</string>"
            "<key>CFBundlePackageType</key><string>APPL</string>"
            "<key>LSUIElement</key><true/></dict></plist>\n", encoding="utf-8")
        script = macos / "decomp-wtf"
        script.write_text(f'#!/bin/sh\nexec "{exe}" >/dev/null 2>&1\n', encoding="utf-8")
        os.chmod(script, 0o755)
        return f"added decomp.wtf to {app.parent}"
    if sys.platform == "win32":
        # Windows says where the Start menu and the desktop are (a desktop is often in OneDrive); a path with an
        # apostrophe in it (a user name) is quoted for PowerShell
        target = str(exe).replace("'", "''")
        ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ws=New-Object -ComObject WScript.Shell;"
              "foreach($d in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){"
              "if($d -and (Test-Path $d)){$l=Join-Path $d 'decomp.wtf.lnk';$s=$ws.CreateShortcut($l);"
              f"$s.TargetPath='{target}';$s.WindowStyle=7;$s.Description='decomp.wtf';$s.Save();Write-Output $l}}}}")
        res = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
        made = [line.strip() for line in res.stdout.splitlines() if line.strip().endswith(".lnk")]
        return "added shortcuts: " + ", ".join(made) if made else "could not create shortcuts"
    return "no launcher for this system; run `decomp`"
