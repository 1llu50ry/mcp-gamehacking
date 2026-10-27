"""Running the Linux-only period compilers on Windows, through WSL 2.

KMC GCC (N64), the PlayStation GCCs, EE-GCC (PS2) and agbcc (GBA) exist only as Linux programs. On Windows they're
installed like any toolchain (downloaded and checked on the Windows side, under the user's toolchain folder) and run
inside WSL 2, which reads that folder through /mnt/<drive>. WSL 1 can't run them: their compilers are 32-bit.

Commands go to WSL as a small shell script in the compile's own folder, so nothing in them depends on how wsl.exe
splits a Windows command line.
"""

from __future__ import annotations

import os
import posixpath
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path, PureWindowsPath

INSTALL = "In PowerShell as administrator, run: wsl --install. Then restart Windows and open Ubuntu once to finish."
_lock = threading.Lock()
_status: tuple[bool, str, float] | None = None
_mount: str | None = None


def wanted() -> bool:
    """Whether Linux-only toolchains go through WSL here (Windows; DECOMP_WSL points tests at a stand-in)."""
    return sys.platform == "win32" or bool(os.environ.get("DECOMP_WSL"))


def exe() -> str | None:
    if os.environ.get("DECOMP_WSL"):
        return os.environ["DECOMP_WSL"]
    found = shutil.which("wsl")
    if found:
        return found
    system = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / "wsl.exe"
    return str(system) if system.exists() else None


def _text(raw: bytes) -> str:
    """wsl.exe's own messages are UTF-16; what the Linux side prints is UTF-8."""
    if b"\x00" in raw[:200]:
        return raw.decode("utf-16-le", errors="replace").replace("\x00", "")
    return raw.decode("utf-8", errors="replace")


def _run(args: list[str], timeout: float) -> tuple[int, str]:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    res = subprocess.run([exe() or "wsl", *args], capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                         creationflags=flags)
    return res.returncode, (_text(res.stdout) + _text(res.stderr)).strip()


def status() -> tuple[bool, str]:
    """(usable, why not): WSL 2 with a Linux distribution that starts. A yes is kept; a no is checked again after a
    minute (the user may be installing WSL right now)."""
    global _status
    with _lock:
        if _status is not None and (_status[0] or time.time() - _status[2] < 60):
            return _status[0], _status[1]
        ok, why = _check()
        _status = (ok, why, time.time())
        return ok, why


def _check() -> tuple[bool, str]:
    if not exe():
        return False, f"WSL 2 isn't installed. {INSTALL}"
    try:
        code, out = _run(["-e", "uname", "-r"], timeout=120)  # the first call starts the WSL machine
    except (OSError, subprocess.TimeoutExpired):
        return False, f"WSL 2 didn't start. {INSTALL}"
    if code != 0:
        # wsl.exe's own error is a multi-line Microsoft message (often with a second install command and a URL).
        # Do not paste it into the app: give one clear instruction instead.
        low = out.lower()
        if "not installed" in low or "optional component" in low:
            return False, f"WSL 2 isn't installed. {INSTALL}"
        if "no installed distribution" in low or "no distribution" in low or ("distribution" in low and "not found" in low):
            return False, f"WSL 2 has no Linux distribution installed. {INSTALL}"
        return False, f"WSL 2 didn't start. {INSTALL}"
    if "microsoft" in out.lower() and "wsl2" not in out.lower() and "standard" not in out.lower():
        return False, ("WSL 1 can't run these 32-bit compilers: switch to WSL 2 (PowerShell: "
                       "wsl --set-default-version 2, then wsl --set-version <distribution> 2).")
    return True, ""


def path(p: str | Path) -> str:
    """A Windows path as WSL sees it (C:\\Users\\me -> /mnt/c/Users/me). Unchanged off Windows."""
    if sys.platform != "win32":
        return str(p)
    win = PureWindowsPath(os.path.abspath(str(p)))
    drive = win.drive.rstrip(":").lower()
    if not drive or len(drive) != 1:
        raise ValueError(f"{p} isn't on a drive letter WSL can reach")
    rest = "/".join(win.parts[1:])
    return f"{mount()}{drive}/{rest}".rstrip("/")


def mount() -> str:
    """Where WSL mounts Windows drives: /mnt/ unless the distribution's wsl.conf says otherwise."""
    global _mount
    if _mount is None:
        _mount = "/mnt/"
        try:
            code, out = _run(["-e", "wslpath", "-u", "C:\\"], timeout=60)
            if code == 0 and out.strip().endswith("/c/"):
                _mount = out.strip()[:-2]
        except (OSError, subprocess.TimeoutExpired):
            pass
    return _mount


def stage_dir() -> str:
    """A new folder in WSL's own file system, for run(stage=...)."""
    return f"/tmp/decompnet-{secrets.token_hex(8)}"


def run(argv: list[str], cwd: Path, timeout: float, *, outputs: list[str] | None = None,
        inputs: list[str] | None = None, stage: str | None = None) -> subprocess.CompletedProcess:
    """Run `argv` (WSL paths) inside WSL in `cwd` (a Windows folder). The command travels as a small script in the
    temp folder, so nothing depends on how wsl.exe splits a Windows command line.

    With `outputs`, it runs in `stage` (a folder in WSL's own file system, a new one by default) instead: `inputs`
    (paths relative to `cwd`, all of it by default) are copied in first and `outputs` copied back after. The old
    32-bit compilers need that: a Windows drive's file IDs don't fit in their inode numbers, so every file they look
    up there fails with "Value too large for defined data type"."""
    q, here = shlex.quote, path(cwd)
    if outputs is None:
        body = f"cd {q(here)} || exit 1\nexec {shlex.join(argv)}\n"
    else:
        stage = stage or stage_dir()
        lines = [f"rm -rf {q(stage)} && mkdir -p {q(stage)} || exit 1", f"trap {q('rm -rf ' + q(stage))} EXIT"]
        for i in inputs if inputs is not None else ["."]:
            into = posixpath.join(stage, posixpath.dirname(i))
            lines.append(f"mkdir -p {q(into)} && cp -R {q(posixpath.join(here, i))} {q(into + '/')} || exit 1")
        lines += [f"mkdir -p {q(posixpath.join(stage, posixpath.dirname(o)))} || exit 1" for o in outputs]
        lines += [f"cd {q(stage)} || exit 1", shlex.join(argv), "rc=$?"]
        lines += [f"[ ! -e {q(o)} ] || cp {q(o)} {q(posixpath.join(here, o))} || rc=1" for o in outputs]
        body = "\n".join([*lines, 'exit "$rc"', ""])
    fd, script = tempfile.mkstemp(prefix="decomp-wsl-", suffix=".sh")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(body.encode())  # LF line ends, whatever the platform
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        res = subprocess.run([exe() or "wsl", "-e", "sh", path(script)], capture_output=True, timeout=timeout,
                             stdin=subprocess.DEVNULL, creationflags=flags)
    finally:
        os.unlink(script)
    return subprocess.CompletedProcess(res.args, res.returncode, _text(res.stdout), _text(res.stderr))


# ------------------------------------------------------------------ 32-bit programs without a 32-bit system

def is_dynamic_i386(p: Path) -> bool:
    """An i386 ELF program that needs the 32-bit loader (/lib/ld-linux.so.2, missing from most WSL systems)."""
    try:
        with open(p, "rb") as f:
            head = f.read(52)
            if len(head) < 52 or head[:4] != b"\x7fELF" or head[4] != 1 or int.from_bytes(head[18:20], "little") != 3:
                return False
            phoff, phentsize, phnum = (int.from_bytes(head[28:32], "little"), int.from_bytes(head[42:44], "little"),
                                       int.from_bytes(head[44:46], "little"))
            for i in range(phnum):
                f.seek(phoff + i * phentsize)
                if int.from_bytes(f.read(4), "little") == 3:  # PT_INTERP
                    return True
    except OSError:
        return False
    return False


def wrap_i386(tree: Path, runtime: str) -> int:
    """Make every dynamic i386 program in `tree` start through the pinned 32-bit loader in `runtime` (a WSL path):
    each becomes `<name>.i386`, and `<name>` a script that runs it with that loader and its libraries. The program
    still sees its own path as argv[0], so GCC finds its passes next to itself. Returns how many were wrapped."""
    n = 0
    loader, libs = shlex.quote(f"{runtime}/ld-linux.so.2"), shlex.quote(runtime)
    for p in sorted(tree.rglob("*")):
        if p.is_file() and not p.is_symlink() and p.suffix != ".i386" and is_dynamic_i386(p):
            real = p.with_name(p.name + ".i386")
            p.replace(real)
            p.write_bytes(f'#!/bin/sh\nexec {loader} --library-path {libs} --argv0 "$0" "$0.i386" "$@"\n'.encode())
            os.chmod(p, 0o755)
            os.chmod(real, 0o755)
            n += 1
    return n
