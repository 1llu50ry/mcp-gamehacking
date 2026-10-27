"""Run decomp.wtf in the background, starting with the computer: for a home PC or a server that hosts a team's room.

Linux: a systemd user service. macOS: a launchd agent. Windows: a startup app of this user (the Run registry key:
a log-on task would need an administrator), without a console window. The service runs `decomp --no-browser` for this
user, nothing more; `decomp service remove` takes it away again.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

LABEL = "wtf.decomp"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"  # Windows: this user's startup apps
RUN_NAME = "decomp.wtf"


def _command() -> list[str]:
    exe = shutil.which("decomp")
    return [exe, "--no-browser"] if exe else [sys.executable, "-m", "decompnet.app.cli", "--no-browser"]


def _windowless() -> list[str]:
    """Windows: the app through decomp.wtf's own pythonw, which opens no console window (closing one would stop it)."""
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return [str(pythonw if pythonw.exists() else sys.executable), "-m", "decompnet.app.cli", "--no-browser"]


def _unit() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "systemd" / "user" / "decomp-wtf.service"


def _plist() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def install() -> str:
    cmd = _command()
    home = os.environ.get("DECOMP_HOME")
    if sys.platform.startswith("linux"):
        unit = _unit()
        unit.parent.mkdir(parents=True, exist_ok=True)
        env = f"Environment=DECOMP_HOME={home}\n" if home else ""
        unit.write_text(f"""[Unit]
Description=decomp.wtf (matching decompilation; serves your rooms)
After=network-online.target

[Service]
ExecStart={subprocess.list2cmdline(cmd)}
{env}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
""", encoding="utf-8")
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
        res = subprocess.run(["systemctl", "--user", "enable", "--now", "decomp-wtf.service"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or "systemctl failed")
        linger = subprocess.run(["loginctl", "enable-linger", os.environ.get("USER", "")], capture_output=True, text=True,
                                encoding="utf-8", errors="replace")
        note = "" if linger.returncode == 0 else (
            "\nTo keep it running while you're logged out (a server), run once: sudo loginctl enable-linger $USER")
        return f"decomp.wtf runs as a service now (systemd user unit {unit}); it starts with the computer.{note}"
    if sys.platform == "darwin":
        plist = _plist()
        plist.parent.mkdir(parents=True, exist_ok=True)
        args = "".join(f"<string>{a}</string>" for a in cmd)
        env = f"<key>EnvironmentVariables</key><dict><key>DECOMP_HOME</key><string>{home}</string></dict>" if home else ""
        plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{LABEL}</string>
<key>ProgramArguments</key><array>{args}</array>{env}
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
""", encoding="utf-8")
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
        res = subprocess.run(["launchctl", "load", str(plist)], capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or "launchctl failed")
        return f"decomp.wtf runs in the background now (launchd agent {plist}); it starts when you log in."
    if sys.platform == "win32":
        import winreg

        cmd = _windowless()
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, subprocess.list2cmdline(cmd))
        subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
        return "decomp.wtf runs in the background now and starts when you log in (Windows' startup apps)."
    raise RuntimeError("running as a service isn't supported on this system")


def remove() -> str:
    if sys.platform.startswith("linux"):
        subprocess.run(["systemctl", "--user", "disable", "--now", "decomp-wtf.service"], capture_output=True)
        _unit().unlink(missing_ok=True)
        subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
    elif sys.platform == "darwin":
        subprocess.run(["launchctl", "unload", str(_plist())], capture_output=True)
        _plist().unlink(missing_ok=True)
    elif sys.platform == "win32":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, RUN_NAME)
        except OSError:
            pass
        subprocess.run(["schtasks", "/Delete", "/F", "/TN", "decomp.wtf"], capture_output=True)  # older versions' task
    return "decomp.wtf no longer runs as a service."


def installed() -> bool:
    if sys.platform.startswith("linux"):
        return _unit().exists()
    if sys.platform == "darwin":
        return _plist().exists()
    if sys.platform == "win32":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
                winreg.QueryValueEx(key, RUN_NAME)
            return True
        except OSError:
            return subprocess.run(["schtasks", "/Query", "/TN", "decomp.wtf"], capture_output=True).returncode == 0
    return False
