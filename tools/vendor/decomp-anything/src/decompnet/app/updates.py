"""Updates: decomp.anything finds out when there's a newer version of itself and, once the user says yes, installs
it and restarts in place (same port, same browser session; helper agents carry on afterwards).

Where updates come from depends on how decomp.anything was installed (install.json, written by the installer):
- "release": the version in this repository's install/install.sh, installed from that version's GitHub tag archive
- "branch":  the newest commit of a branch on GitHub, installed from GitHub's archive of that commit
Installing is `uv tool install --force` of the new version, then its `decomp setup` (new pinned tools), then the
running app becomes the new version with exec (the process, its console window and its port stay the same).
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .. import __version__, hostenv, toolchains

REPO = "giveen/decomp.anything"
RECHECK = {"release": 3 * 3600, "branch": 15 * 60}  # GitHub allows 60 unauthenticated API calls an hour


def info_file() -> Path:
    """How this copy was installed. Outside uv's tool environment, which every install replaces."""
    return toolchains.data_dir() / "install.json"


def installed() -> dict:
    try:
        data = json.loads(info_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict) or data.get("channel") not in ("release", "branch"):
        data = {"channel": "release"}
    data.setdefault("repo", REPO)
    data["version"] = __version__
    return data


def record(channel: str, branch: str = "", commit: str = "", repo: str = REPO) -> dict:
    data = {"channel": channel if channel in ("release", "branch") else "release", "repo": repo or REPO,
            "branch": branch, "commit": commit, "version": __version__, "t": time.time()}
    if data["channel"] == "release":
        data.update(branch="", commit="")
    info_file().parent.mkdir(parents=True, exist_ok=True)
    info_file().write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def _get(url: str, timeout: float = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": f"decomp.anything/{__version__} (update check)",
                                               "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _json(url: str) -> dict:
    return json.loads(_get(url))


def _first_line(message: str) -> str:
    return (message or "").strip().splitlines()[0][:140] if (message or "").strip() else ""


def _check_release(cur: dict) -> dict:
    repo = cur.get("repo") or REPO
    text = _get(f"https://raw.githubusercontent.com/{repo}/main/install/install.sh").decode("utf-8", "replace")
    m = re.search(r'^VERSION="([^"]+)"', text, re.MULTILINE)
    if not m:
        raise ValueError("the installer didn't say which version is current")
    latest = m.group(1)
    newer = version_key(latest) > version_key(cur["version"])
    spec = f"decompnet @ https://github.com/{repo}/archive/refs/tags/v{latest}.tar.gz"
    return {"available": newer, "latest": {"version": latest, "commit": "", "date": None},
            "notes": [], "link": f"https://github.com/{repo}/commits/main", "spec": spec}


def _branch_version(repo: str, sha: str) -> str:
    try:
        text = _get(f"https://raw.githubusercontent.com/{repo}/{sha}/pyproject.toml").decode("utf-8", "replace")
        m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
        return m.group(1) if m else ""
    except (OSError, ValueError):
        return ""


def _check_branch(cur: dict) -> dict:
    repo, branch, have = cur["repo"], cur.get("branch") or "main", cur.get("commit") or ""
    head = _json(f"https://api.github.com/repos/{repo}/commits/{urllib.parse.quote(branch, safe='')}")
    sha = head["sha"]
    notes: list[str] = []
    available = bool(sha) and sha != have
    if available and have:
        try:  # what changed, and whether the branch is really ahead of what's installed (not behind it)
            cmp = _json(f"https://api.github.com/repos/{repo}/compare/{have}...{sha}")
            if cmp.get("status") in ("identical", "behind"):
                available = False
            notes = [_first_line(c["commit"]["message"]) for c in reversed(cmp.get("commits") or [])][:12]
        except (urllib.error.HTTPError, KeyError, ValueError):  # a commit GitHub doesn't know (never pushed)
            pass
    if available and not notes:
        notes = [_first_line(head["commit"]["message"])]
    return {"available": available,
            "latest": {"version": _branch_version(repo, sha) if available else cur["version"], "commit": sha,
                       "date": (head.get("commit") or {}).get("committer", {}).get("date")},
            "notes": [n for n in notes if n], "link": f"https://github.com/{repo}/commits/{branch}",
            "spec": f"decompnet @ https://github.com/{repo}/archive/{sha}.tar.gz"}


def check() -> dict:
    """What's installed, what's newest, and whether that's an update (network: GitHub or decomp.wtf)."""
    cur = installed()
    out = {"current": cur, "available": False, "latest": None, "notes": [], "link": None, "error": None,
           "checked": time.time(), "can_apply": can_apply()[0], "why_not": can_apply()[1]}
    try:
        out.update(_check_branch(cur) if cur["channel"] == "branch" else _check_release(cur))
    except (OSError, ValueError, KeyError) as e:
        out["error"] = f"couldn't check for updates: {e}"
    return out


def uv() -> str | None:
    found = shutil.which("uv")
    if found:
        return found
    for d in (Path.home() / ".local" / "bin", Path.home() / ".cargo" / "bin"):
        if (d / "uv").exists():
            return str(d / "uv")
    return None


def can_apply() -> tuple[bool, str]:
    if sys.platform == "win32":
        return False, ("decomp.anything now runs in WSL 2 on Windows: run the installer again in PowerShell "
                       "(irm https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.ps1 | iex) "
                       "to switch to it")
    if not uv():
        return False, "uv isn't installed here, so decomp.anything can't update itself: run the installer again"
    return True, ""


def install(found: dict, log=print) -> dict:
    """Install the version check() found. Returns the new install info (not yet the running version)."""
    ok, why = can_apply()
    if not ok:
        raise RuntimeError(why)
    cur = found["current"]
    log(f"installing decomp.wtf {found['latest'].get('version') or ''}".rstrip()
        + (f" ({cur.get('branch')} @ {found['latest']['commit'][:7]})" if cur["channel"] == "branch" else ""))
    cmd = [uv(), "tool", "install", "--force", "--python", "3.12", found["spec"]]
    _stream(cmd, log, "installing the update failed")
    bindir = subprocess.run([uv(), "tool", "dir", "--bin"], capture_output=True, text=True).stdout.strip()
    decomp = Path(bindir) / "decomp" if bindir else None
    if not decomp or not decomp.exists():
        raise RuntimeError("the update was installed, but its decomp command isn't there")
    log("getting the tools this version needs")
    _stream([str(decomp), "setup"], log, "setting up the new version's tools failed")
    data = {"channel": cur["channel"], "repo": cur.get("repo") or REPO, "branch": cur.get("branch") or "",
            "commit": found["latest"].get("commit") or "", "version": found["latest"].get("version") or "",
            "t": time.time()}
    info_file().write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def _stream(cmd: list[str], log, failure: str) -> None:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            text=True, encoding="utf-8", errors="replace", env=dict(os.environ, NO_COLOR="1"))
    tail: list[str] = []
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            tail = ([*tail, line])[-20:]
            log(f"  {line}")
    if proc.wait() != 0:
        raise RuntimeError(f"{failure} (exit code {proc.returncode}): {' / '.join(tail[-3:])}")


def restart(port: int, secret: str) -> None:
    """Become the newly installed version: same process (its console window stays), same port and secret (the
    browser tab keeps working). Never returns."""
    env = dict(os.environ, DECOMP_RESTART=json.dumps({"port": port, "secret": secret}))
    for stream in (sys.stdout, sys.stderr):
        with contextlib.suppress(OSError, ValueError, AttributeError):
            stream.flush()
    argv = [sys.executable, "-m", "decompnet.app.cli", "--no-browser", "--port", str(port)]
    if not Path(sys.executable).exists():  # the environment moved: its decomp command starts the same way
        bindir = subprocess.run([uv() or "uv", "tool", "dir", "--bin"], capture_output=True, text=True).stdout.strip()
        argv = [str(Path(bindir) / "decomp"), "--no-browser", "--port", str(port)]
    os.execve(argv[0], argv, env)


class Updater:
    """The app's update state: the last check (cached) and an update being installed."""

    def __init__(self, before_restart, port: int, secret: str):
        self.before_restart, self.port, self.secret = before_restart, port, secret
        self.last: dict | None = None
        self.job = {"state": "idle", "log": [], "error": None}
        self._lock = threading.Lock()

    def status(self, refresh: bool = False) -> dict:
        cur = self.last
        channel = installed()["channel"]
        if refresh or cur is None or time.time() - cur.get("checked", 0) > RECHECK[channel]:
            self.last = cur = check()
        return {**cur, "job": {k: (v[-200:] if k == "log" else v) for k, v in self.job.items()},
                "runtime": hostenv.runtime()}

    def apply(self) -> None:
        """Install the update in the background, then restart into it."""
        with self._lock:
            if self.job["state"] in ("installing", "restarting"):
                return
            found = self.last if self.last and self.last.get("available") else check()
            if not found.get("available"):
                raise ValueError(found.get("error") or "decomp.wtf is up to date")
            ok, why = can_apply()
            if not ok:
                raise ValueError(why)
            self.job = {"state": "installing", "log": [], "error": None}

        def log(line: str) -> None:
            self.job["log"].append(str(line))

        def run() -> None:
            try:
                install(found, log=log)
            except (OSError, RuntimeError, subprocess.SubprocessError) as e:
                self.job.update(state="error", error=str(e))
                return
            self.job["state"] = "restarting"
            log("restarting decomp.wtf")
            time.sleep(1)  # the page sees "restarting" before the server goes away
            try:
                self.before_restart()
                restart(self.port, self.secret)
            except OSError as e:  # still the old version: say so (`decomp` starts the new one)
                self.job.update(state="error", error=f"the update is installed, but restarting failed ({e}): "
                                                       "quit decomp.wtf and start it again")

        threading.Thread(target=run, daemon=True, name="update").start()
