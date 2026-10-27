"""Pinned compiler toolchains: registry, verified install, and lookup for the compile sandbox.

A toolchain is one or more upstream archives, each verified against a pinned sha256 and
extracted into its own directory. Projects name a toolchain in project.toml; the compiler
sandbox mounts that directory (and any runtime it requires) read-only.
"""

from __future__ import annotations

import functools
import hashlib
import json
import os
import platform as _platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
import urllib.request
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path

from . import wsl

MANIFEST = ".decompnet-toolchain.json"
LINUX = "linux-x86_64"
# Parts for WSL: Linux programs packed in a format Windows can unpack (a .deb, not a .zst)
WSL_PLATFORM = "wsl-x86_64"


class ToolchainError(RuntimeError):
    pass


@dataclass
class Toolchain:
    id: str
    name: str
    license: str
    source: str
    description: str = ""
    kind: str = "compiler"  # compiler | runtime | tool
    platform: str = ""
    arch: str = ""
    cc: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)
    cmd: list[str] = field(default_factory=list)  # full command template, when compiling is more than cc + flags
    parts: list[dict] = field(default_factory=list)
    git: str = ""
    commit: str = ""
    binary_name: str = ""  # main executable of a tool, without .exe
    npm: str = ""  # a package@version installed with npm (rea-agents)
    pip_extra: list[str] = field(default_factory=list)  # extra requirements for a git tool's environment
    requires_java: int = 0  # minimum Java version (Ghidra)
    system: bool = False  # a compiler already on the host (MinGW, MSVC under wine), not a downloaded package
    download: str = ""  # where to get a system compiler's own download (Windows MinGW/LLVM), if there is one

    @property
    def proprietary(self) -> bool:
        return self.license.lower() == "proprietary"

    def parts_for(self, plat: str | None = None) -> list[dict]:
        plat = plat or current_platform()
        return [p for p in self.parts if plat in p.get("platforms", [plat])]

    @property
    def via_wsl(self) -> bool:
        """A Linux-only toolchain on Windows: installed from its Linux build and run inside WSL 2 (see wsl.py)."""
        return wsl.wanted() and not self.git and not self.parts_for() and bool(self.parts_for(LINUX))

    def linux_parts(self) -> list[dict]:
        return [p for p in self.parts if WSL_PLATFORM in p.get("platforms", [])] or self.parts_for(LINUX)

    @property
    def supported(self) -> bool:
        """Whether this toolchain can be installed on this computer (on Windows, Linux ones through WSL 2)."""
        return self.system or bool(self.git) or bool(self.npm) or bool(self.parts_for()) or self.via_wsl


def current_platform() -> str:
    """linux-x86_64, linux-aarch64, macos-x86_64, macos-arm64 or windows-x86_64."""
    os_name = {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux" if sys.platform.startswith("linux") else sys.platform)
    machine = _platform.machine().lower()
    machine = {"amd64": "x86_64", "x64": "x86_64", "arm64": "arm64" if os_name == "macos" else "aarch64",
               "aarch64": "aarch64" if os_name != "macos" else "arm64"}.get(machine, machine)
    return f"{os_name}-{machine}"


def unsupported_cpu() -> str | None:
    """Why this computer can't run the games' compilers, or None: they're x86 programs, which an ARM computer
    (a Raspberry Pi, an ARM laptop or server) doesn't run."""
    machine = current_platform().split("-", 1)[1]
    if machine == "x86_64":
        return None
    return (f"decomp.wtf needs a 64-bit Intel or AMD PC for now (the games' compilers are x86 programs; this "
            f"computer's processor is {machine})")


@functools.cache
def _registry_data() -> dict:
    return tomllib.loads(resources.files("decompnet").joinpath("toolchains.toml").read_text(encoding="utf-8"))


def registry() -> dict[str, Toolchain]:
    return {tid: Toolchain(id=tid, **spec) for tid, spec in _registry_data().items()}


def get(tid: str) -> Toolchain:
    reg = registry()
    if tid not in reg:
        raise ToolchainError(f"unknown toolchain {tid!r}; known: {', '.join(sorted(reg))}")
    return reg[tid]


def data_dir() -> Path:
    """Per-user data directory for decompnet (toolchains, caches)."""
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "decompnet"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "decompnet"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "decompnet"


def root() -> Path:
    env = os.environ.get("DECOMPNET_TOOLCHAINS")
    return Path(env).expanduser() if env else data_dir() / "toolchains"


def _manifest(tid: str, linux: bool | None = None) -> Path:
    """The manifest an install writes. A WSL install lives under wsl/, but an older one may be at the root."""
    tc = get(tid)
    if linux is None:
        if tc.via_wsl:
            wsl_dir = root() / "wsl" / tid
            if (wsl_dir / MANIFEST).exists():
                return wsl_dir / MANIFEST
            legacy = root() / tid / MANIFEST
            return legacy if legacy.exists() else wsl_dir / MANIFEST
        linux = False
    return (root() / "wsl" / tid if linux else root() / tid) / MANIFEST


def path(tid: str, linux: bool | None = None) -> Path:
    """Where a toolchain is installed. `linux`: its Linux build for WSL (default: when that's how it runs here)."""
    if linux is None:
        return _manifest(tid).parent
    return (root() / "wsl" / tid if linux else root() / tid)


def _windows_registry_paths() -> list[Path]:
    """The PATH Windows currently has, including an installer's changes the running process hasn't inherited."""
    if sys.platform != "win32":
        return []
    import winreg

    out: list[Path] = []
    for hive, key_path in ((winreg.HKEY_CURRENT_USER, "Environment"),
                          (winreg.HKEY_LOCAL_MACHINE,
                           r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(hive, key_path) as key:
                value, _kind = winreg.QueryValueEx(key, "Path")
        except OSError:
            continue
        for part in str(value).split(";"):
            part = os.path.expandvars(part.strip().strip('"'))
            if part:
                out.append(Path(part))
    return out


def _windows_dirs() -> list[Path]:
    """Common places a Windows compiler is installed, including ones the app's PATH hasn't picked up yet."""
    if sys.platform != "win32":
        return []
    home = Path.home()
    drive = Path(os.environ.get("SYSTEMDRIVE", "C:") + "\\")
    dirs: list[Path] = []

    def add(p: Path) -> None:
        if p not in dirs:
            dirs.append(p)

    for p in _windows_registry_paths():
        add(p)
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        if value := os.environ.get(env):
            base = Path(value)
            for name in ("LLVM", "mingw64", "mingw32", "mingw-w64", "WinLibs"):
                add(base / name / "bin")
                add(base / name / "mingw64" / "bin")
                add(base / name / "mingw32" / "bin")
            add(base / "Programs" / "LLVM" / "bin")
            add(base / "Programs" / "mingw64" / "bin")
            # Visual Studio's own cl.exe: the 32-bit-targeting one first (most old games are x86), then
            # the x64 toolsets. The arch-specific entries below decide which one a project gets.
            for vs in ("Microsoft Visual Studio 8", "Microsoft Visual Studio 9.0", "Microsoft Visual Studio 10.0",
                       "Microsoft Visual Studio 11.0", "Microsoft Visual Studio 12.0", "Microsoft Visual Studio 14.0"):
                add(base / vs / "VC" / "bin")
                add(base / vs / "VC" / "bin" / "amd64")
            for install in base.glob("Microsoft Visual Studio/*/*/VC/Tools/MSVC/*"):
                add(install / "bin" / "Hostx64" / "x86")
                add(install / "bin" / "Hostx64" / "x64")
    for name in ("mingw64", "mingw32", "clang64", "ucrt64", "TDM-GCC-64"):
        add(drive / "msys64" / name / "bin")
    for name in ("mingw64", "mingw32", "TDM-GCC-64"):
        add(drive / name / "bin")
    add(drive / "ProgramData" / "chocolatey" / "bin")
    for base in (home / "Downloads", home / "Desktop", home):
        add(base / "mingw64" / "bin")
        add(base / "mingw32" / "bin")
        for extracted in base.glob("winlibs-*"):
            add(extracted / "mingw64" / "bin")
            add(extracted / "mingw32" / "bin")
    return dirs


def system_binary(tc: Toolchain) -> Path | None:
    """The host compiler/tool itself. PATH first, then common Windows install folders (MSYS2, WinLibs, LLVM)."""
    command = tc.cmd[0] if tc.cmd else ""
    if not command or (sys.platform == "win32" and tc.platform == "Linux"):
        return None
    found = shutil.which(command)
    if found:
        return Path(found)
    if tc.platform != "Windows" and tc.id not in ("rizin", "detect-it-easy", "llvm-tools"):
        return None  # a Linux gcc/clang on Windows must not resolve to a MinGW/LLVM binary by accident
    for directory in _windows_dirs():
        for name in (command, command + ".exe"):
            candidate = directory / name
            if candidate.is_file():
                return candidate
    return None


def installed(tid: str, linux: bool | None = None) -> dict | None:
    tc = get(tid)
    if tc.system:
        return {"system": True, "id": tid} if system_binary(tc) else None
    m = _manifest(tid, linux)
    return json.loads(m.read_text(encoding="utf-8")) if m.exists() else None


def require(tid: str, linux: bool | None = None) -> Path:
    """Directory of an installed toolchain, or a clear error telling the operator how to install it."""
    if installed(tid, linux) is None:
        raise ToolchainError(f"toolchain {tid!r} is not installed: run `decompnet toolchain install {tid}`")
    return path(tid, linux)


def runtime_dirs(tid: str) -> tuple[Path, ...]:
    """The toolchain plus everything it requires, for mounting into the sandbox (all Linux builds for WSL)."""
    tc = get(tid)
    linux = tc.via_wsl
    return (require(tid, linux), *(require(dep, linux) for dep in tc.requires))


# ---------------------------------------------------------------------------- install

def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path, log) -> None:
    log(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "decompnet-toolchain-installer"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def _deb_data(deb: Path, out: Path) -> Path:
    """The data.tar.* inside a Debian package (an `ar` archive), written to `out`."""
    with open(deb, "rb") as f:
        if f.read(8) != b"!<arch>\n":
            raise ToolchainError(f"{deb.name} isn't a Debian package")
        while len(head := f.read(60)) == 60:
            name, size = head[:16].decode().strip().rstrip("/"), int(head[48:58].decode().strip())
            data = f.read(size)
            if size % 2:
                f.read(1)
            if name.startswith("data.tar"):
                (out / name).write_bytes(data)
                return out / name
    raise ToolchainError(f"{deb.name} has no data.tar")


def _extract(archive: Path, dest: Path, subdir: str | None) -> None:
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        if archive.name.endswith(".deb"):
            with tempfile.TemporaryDirectory(dir=dest.parent) as raw, tarfile.open(_deb_data(archive, Path(raw))) as t:
                t.extractall(tmp, filter="data")
        elif archive.name.endswith(".zip"):
            import zipfile

            with zipfile.ZipFile(archive) as z:
                for info in z.infolist():
                    target = (Path(tmp) / info.filename).resolve()
                    if Path(tmp).resolve() not in target.parents and target != Path(tmp).resolve():
                        raise ToolchainError(f"refusing to extract {info.filename} outside the toolchain folder")
                    z.extract(info, tmp)
                    mode = info.external_attr >> 16
                    if mode & 0o111 and not info.is_dir():
                        os.chmod(target, 0o755)
        elif archive.name.endswith(".zst"):
            # GNU tar extracts it; never restore owners from the archive. The zstd layer is undone here first: tar
            # would run the zstd command for it, which many systems don't have (tar then just fails with code 2)
            import zstandard

            plain = Path(tmp).with_name(Path(tmp).name + ".tar")
            try:
                with open(archive, "rb") as src, open(plain, "wb") as out:
                    zstandard.ZstdDecompressor().copy_stream(src, out)
                subprocess.run(["tar", "-xf", str(plain), "-C", tmp, "--no-same-owner", "--no-same-permissions"],
                               check=True, capture_output=True)
            finally:
                plain.unlink(missing_ok=True)
        else:
            # gz/xz in pure Python, so this works on Windows and macOS too. The "data" filter refuses
            # absolute paths, links out of the tree and device files, and drops setuid bits.
            with tarfile.open(archive) as t:
                t.extractall(tmp, filter="data")
        src = Path(tmp) / subdir if subdir else Path(tmp)
        if not src.is_dir():
            raise ToolchainError(f"archive {archive.name} has no {subdir}/")
        for item in src.iterdir():
            target = dest / item.name
            if target.exists():
                shutil.rmtree(target) if target.is_dir() and not target.is_symlink() else target.unlink()
            shutil.move(str(item), target)


def install(tid: str, *, accept_license: bool = False, force: bool = False, log=print, linux: bool | None = None) -> Path:
    """Install a toolchain (and what it requires). `linux`: its Linux build, to run inside WSL (default: when
    that's how it runs on this computer)."""
    tc = get(tid)
    linux = tc.via_wsl if linux is None else linux
    if linux:
        ok, why = wsl.status()
        if not ok:
            raise ToolchainError(f"{tc.name} runs in WSL 2 on Windows. {why}")
    for dep in tc.requires:
        if installed(dep, linux) is None or force:
            install(dep, accept_license=accept_license, force=force, log=log, linux=linux)
    if installed(tid, linux) and not force:
        log(f"{tid}: already installed at {path(tid, linux)}")
        return path(tid, linux)
    if tc.system:
        raise _system_missing(tc)
    parts = tc.linux_parts() if linux else tc.parts_for()
    if not parts and not tc.git and not tc.npm:
        why = unsupported_cpu()
        raise ToolchainError(f"{tid} ({tc.name}) has no build for this computer ({current_platform()})"
                             + (f": {why}" if why else ""))
    if tc.requires_java and java_version() < tc.requires_java:
        raise ToolchainError(f"{tc.name} needs Java {tc.requires_java} or newer: install it from https://adoptium.net first")
    if tc.proprietary and not accept_license:
        raise ToolchainError(
            f"{tid} ({tc.name}) is proprietary software. Running it on your coordinator is your own licensing "
            f"decision; re-run with --accept-license if you accept that.")

    dest = path(tid, linux)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    log(f"{tid}: installing {tc.name} [{tc.license}]" + (" (Linux build, runs in WSL 2)" if linux else ""))
    pinned = []
    try:
        if tc.git:
            _install_git_tool(tc, dest, log)
        if tc.npm:
            _install_npm_tool(tc, dest, log)
        downloads = root() / ".downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        for part in parts:
            archive = downloads / Path(part["url"]).name
            if not archive.exists() or (part.get("sha256") and _sha256(archive) != part["sha256"]):
                _download(part["url"], archive, log)
            digest = _sha256(archive)
            if part.get("sha256") and digest != part["sha256"]:
                archive.unlink()
                raise ToolchainError(f"checksum mismatch for {part['url']}: expected {part['sha256']}, got {digest}")
            if not part.get("sha256"):
                log(f"  no pinned checksum in the registry; pinning on first use: sha256 {digest}")
            if part.get("binary"):  # a plain executable, not an archive
                shutil.copyfile(archive, dest / part["binary"])
                os.chmod(dest / part["binary"], 0o755)
            else:
                _extract(archive, dest, part.get("subdir"))
                if part.get("executable"):  # archives that don't record the executable bit
                    for f in dest.rglob("*"):
                        if f.is_file():
                            os.chmod(f, 0o755)
            pinned.append({"url": part["url"], "sha256": digest})
        if linux and "runtime-i386" in tc.requires:  # WSL systems rarely have a 32-bit loader: bring ours
            n = wsl.wrap_i386(dest, wsl.path(path("runtime-i386", linux=True)))
            log(f"  {n} 32-bit programs start through the pinned 32-bit runtime")
    except BaseException:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    (dest / MANIFEST).write_text(json.dumps({
        "id": tid, "name": tc.name, "license": tc.license, "source": tc.source,
        "parts": pinned, "commit": tc.commit or None, "installed_at": time.time(),
        "license_accepted": bool(tc.proprietary and accept_license), "wsl": linux,
    }, indent=2), encoding="utf-8")
    log(f"{tid}: installed at {dest}")
    return dest


def venv_bin(venv: Path, name: str) -> Path:
    """Path of an executable inside a virtual environment, on any OS."""
    return venv / "Scripts" / f"{name}.exe" if sys.platform == "win32" else venv / "bin" / name


def _install_git_tool(tc: Toolchain, dest: Path, log) -> None:
    uv = shutil.which("uv")
    if not uv:
        raise ToolchainError(f"{tc.id} needs `uv` to create its isolated environment")
    if not shutil.which("git"):
        # uv can fetch the pinned commit as an archive when git is missing
        spec = f"{tc.id} @ {tc.git.removesuffix('.git')}/archive/{tc.commit}.zip"
    else:
        spec = f"{tc.id} @ git+{tc.git}@{tc.commit}"
    log(f"  creating an isolated environment for {tc.git} @ {tc.commit[:10]}")
    subprocess.run([uv, "venv", "--quiet", "--python", "3.12", str(dest / "venv")], check=True)
    subprocess.run([uv, "pip", "install", "--quiet", "--python", str(venv_bin(dest / "venv", "python")), spec, *tc.pip_extra],
                   check=True)


def _install_npm_tool(tc: Toolchain, dest: Path, log) -> None:
    npm = shutil.which("npm")
    if not npm or not (shutil.which("node") or shutil.which("node.exe")):
        raise ToolchainError(f"{tc.id} needs Node.js and npm (https://nodejs.org)")
    log(f"  installing {tc.npm} with npm")
    proc = subprocess.run([npm, "install", "--prefix", str(dest), "--no-save", "--no-package-lock",
                           "--no-audit", "--no-fund", "--loglevel=error", tc.npm],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in (proc.stdout + proc.stderr).splitlines():
        if line.strip():
            log(f"  {line.strip()}")
    if proc.returncode:
        raise ToolchainError(f"npm couldn't install {tc.npm} (exit {proc.returncode})")


def binary(tid: str) -> Path:
    """The main executable of an installed tool (objdiff-cli, dtk, coddog, ...), on any OS."""
    tc = get(tid)
    base = require(tid)
    name = tc.binary_name or tid
    npm_bin = base / "node_modules" / ".bin"
    for candidate in (base / f"{name}.exe", base / name, base / "bin" / name,
                      npm_bin / f"{name}.cmd", npm_bin / f"{name}.exe", npm_bin / name):
        if candidate.exists():
            return candidate
    raise ToolchainError(f"{tid} is installed but {name} wasn't found in {base}")


def _system_missing(tc: Toolchain) -> ToolchainError:
    """A compiler the host provides (MinGW, clang-cl, a Linux gcc) is never downloaded."""
    command = tc.cmd[0] if tc.cmd else tc.id
    return ToolchainError(
        f"{tc.name} is a compiler on this computer, not a download: {command} is not on PATH. "
        f"Install it and add its bin folder to PATH (on Windows: MinGW-w64 or LLVM), then reopen the app, "
        f"or set its command in the project's [compiler] section.")


def ensure(tid: str, log=print) -> Path:
    """Install a free tool on first use and return its folder. Proprietary ones must be installed explicitly."""
    if installed(tid) is None:
        tc = get(tid)
        if tc.system:
            raise _system_missing(tc)
        if tc.proprietary:
            raise ToolchainError(f"{tc.name} is proprietary: install it from Setup if you accept its license")
        install(tid, log=log)
    return path(tid)


def java_version() -> int:
    """Major version of the java on PATH, 0 if none."""
    import re as _re

    exe = shutil.which("java")
    if not exe:
        return 0
    try:
        out = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=20,
                             encoding="utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return 0
    m = _re.search(r'version "(\d+)', out.stderr + out.stdout)
    return int(m.group(1)) if m else 0


def status() -> list[dict]:
    rows = []
    windows = current_platform().startswith("windows")
    for tc in registry().values():
        m = installed(tc.id)
        rows.append({"id": tc.id, "name": tc.name, "kind": tc.kind, "platform": tc.platform, "license": tc.license,
                     "installed": m is not None, "supported": tc.supported, "description": tc.description,
                     "wsl": tc.via_wsl, "system": tc.system, "command": tc.cmd[0] if tc.cmd else "",
                     "download": tc.download if windows else "",
                     "pinned": all(p.get("sha256") for p in tc.parts) or bool(tc.commit) or bool(tc.npm)})
    return rows
