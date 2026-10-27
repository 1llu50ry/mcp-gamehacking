"""Where decomp.wtf runs, and how it reaches the computer around it.

decomp.wtf is a Linux program everywhere: on Linux it runs on the computer itself ("native"); on Windows inside
its own WSL 2 distribution ("wsl", made by install.ps1); on servers, if wanted, in a Docker container ("docker",
install/Dockerfile). Everything inside is the same Linux; only a few things cross to the computer the
user sits at: opening the browser or a folder, and file paths the user types (C:\\Users\\..., ~/Downloads/...).
"""

from __future__ import annotations

import functools
import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path, PureWindowsPath

RUNTIME_FILE = Path("/etc/decomp-wtf-runtime")  # written by linux-base.sh: "wsl" or "docker"


@functools.cache
def runtime() -> str:
    """native, wsl or docker."""
    if (env := os.environ.get("DECOMP_RUNTIME", "").strip()) in ("native", "wsl", "docker"):
        return env
    try:
        made = RUNTIME_FILE.read_text(encoding="utf-8").strip()
        if made in ("wsl", "docker"):
            return made
    except OSError:
        pass
    if sys.platform.startswith("linux"):
        if os.environ.get("WSL_DISTRO_NAME") or Path("/proc/sys/fs/binfmt_misc/WSLInterop").exists():
            return "wsl"
        if Path("/.dockerenv").exists():
            return "docker"
    return "native"


def host_os() -> str:
    """The system the user sits at: linux, windows or macos."""
    if runtime() == "wsl":
        return "windows"
    if runtime() == "docker":
        return os.environ.get("DECOMP_HOST_OS") or "linux"
    return {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")


def distro() -> str:
    return os.environ.get("WSL_DISTRO_NAME") or "decomp-wtf"


# ---------------------------------------------------------------------------------- Windows, from inside WSL

@functools.cache
def _windows_tool(name: str) -> str | None:
    """A program in Windows' System32, reachable through WSL's interop (Windows' PATH isn't on ours)."""
    found = shutil.which(name)
    if found:
        return found
    for root in sorted(Path("/mnt").glob("[a-z]")):
        exe = root / "Windows" / "System32" / name
        if exe.exists():
            return str(exe)
    return None


def windows_path(path: Path | str) -> str:
    """How Windows reaches a file of this WSL system: \\\\wsl.localhost\\decomp-wtf\\home\\..."""
    try:
        res = subprocess.run(["wslpath", "-w", str(path)], capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    p = str(path)
    if p.startswith("/mnt/") and len(p) > 6 and p[6:7] in ("/", ""):
        return f"{p[5].upper()}:\\" + p[7:].replace("/", "\\")
    return f"\\\\wsl.localhost\\{distro()}" + p.replace("/", "\\")


def _from_windows(text: str) -> Path | None:
    """C:\\Users\\me\\game.iso (or C:/Users/...) and \\\\wsl.localhost\\<distro>\\... as paths here."""
    if text.startswith(("\\\\wsl.localhost\\", "\\\\wsl$\\")):
        parts = PureWindowsPath(text).parts  # ('\\\\wsl.localhost\\decomp-wtf\\', 'home', ...)
        return Path("/", *parts[1:])
    if len(text) >= 3 and text[0].isalpha() and text[1] == ":" and text[2] in "\\/":
        try:
            res = subprocess.run(["wslpath", "-u", text], capture_output=True, text=True, timeout=10)
            if res.returncode == 0 and res.stdout.strip():
                return Path(res.stdout.strip())
        except (OSError, subprocess.TimeoutExpired):
            pass
        return Path("/mnt", text[0].lower(), *PureWindowsPath(text).parts[1:])
    return None


# ---------------------------------------------------------------------------------- crossing over

def local_path(text: str) -> Path:
    """A file path the user (or their agent, on their own computer) gave, as decomp.wtf sees it.

    WSL: Windows paths become /mnt/c/...; Docker: the host's home is mounted at the same path inside, and ~ means
    the user's home there, not the container's."""
    text = text.strip().strip('"').strip("'")
    if runtime() == "wsl" and (p := _from_windows(text)) is not None:
        return p
    if runtime() == "docker" and (host_home := os.environ.get("DECOMP_HOST_HOME")) and (text == "~" or text.startswith("~/")):
        return Path(host_home + text[1:])
    return Path(text).expanduser()


def shown_path(path: Path | str) -> str:
    """A path of decomp.wtf's, as the user can open it on their own computer."""
    if runtime() == "wsl":
        return windows_path(path)
    return str(path)


def open_url(url: str) -> bool:
    """Open a page in the user's browser. False when that can't be done from here (Docker: the host opens it)."""
    rt = runtime()
    if rt == "docker":
        return False
    if rt == "wsl":
        exe = _windows_tool("rundll32.exe")
        if not exe:
            return False
        try:  # no cmd.exe in between: it would read & and ^ in the address as its own
            subprocess.Popen([exe, "url.dll,FileProtocolHandler", url], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return True
        except OSError:
            return False
    try:
        return webbrowser.open(url)
    except Exception:  # noqa: BLE001 no browser at all (a server)
        return False


def open_folder(path: Path) -> str | None:
    """Show a folder in the user's file manager. Returns why it couldn't, or None."""
    rt = runtime()
    if rt == "docker":
        return (f"Your projects are inside decomp.wtf's Docker volume ({path}). Open a terminal there with "
                f"`decomp shell`, or copy this one out with: docker cp decomp-wtf:{path} ~/Desktop/")
    if rt == "wsl":
        exe = _windows_tool("explorer.exe")
        if not exe:
            return f"Open this in Windows' file explorer: {windows_path(path)}"
        subprocess.Popen([exe, windows_path(path)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)  # explorer.exe always exits with 1
        return None
    if sys.platform == "win32":
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return None


def host_bridge() -> list[str] | None:
    """How an agent on the user's own computer starts `decomp mcp` when decomp.wtf runs in WSL or Docker (None:
    decomp.wtf runs on that computer itself)."""
    rt = runtime()
    if rt == "wsl":  # WSL doesn't pass Windows' environment through: the agent's name goes in as --name
        return ["wsl.exe", "-d", distro(), "--cd", "~", "--exec", "/usr/local/bin/decomp", "mcp"]
    if rt == "docker":
        home = os.environ.get("DECOMP_HOST_HOME")
        return [f"{home}/.local/bin/decomp", "mcp"] if home else ["docker", "exec", "-i", "decomp-wtf", "decomp", "mcp"]
    return None


def terminal_hint() -> str:
    """How the user opens a terminal where decomp.wtf's helper agents live (to sign them in)."""
    rt = runtime()
    if rt == "wsl":
        return "Open decomp.wtf's terminal (run `decomp shell` in PowerShell, or `wsl -d decomp-wtf`)"
    if rt == "docker":
        return "Open decomp.wtf's terminal (run `decomp shell` in your terminal)"
    return "Open a terminal"


def info() -> dict:
    return {"runtime": runtime(), "host_os": host_os()}
