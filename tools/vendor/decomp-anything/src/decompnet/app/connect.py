"""Make decomp.wtf available inside the AI agents the user already uses: register `decomp mcp` with Claude Code,
Codex, Antigravity CLI and opencode (their own `mcp add` commands; opencode's config file). After that, asking the
agent "decompile my game at ~/roms/game.z64" is enough: it finds decomp.wtf's tools and the app shows its work live.
Only done when the user clicks Connect (or runs `decomp connect`)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .agents import AGY_ALLOW, KINDS, _which, agy_settings, argv, kind_id

NAME = "decomp"
LABEL = {"claude": "claude-code", "codex": "codex", "antigravity": "antigravity", "opencode": "opencode"}


def bridge_command() -> list[str]:
    """How an agent starts the bridge: the `decomp` command when it's on PATH, else this Python with the module."""
    exe = shutil.which("decomp")
    return [exe, "mcp"] if exe else [sys.executable, "-m", "decompnet.app.cli", "mcp"]


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
    """Run an agent's own CLI (on Windows an npm .cmd through node, see agents.argv), reading its output as UTF-8."""
    return subprocess.run(argv(cmd), capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          encoding="utf-8", errors="replace", timeout=timeout)


def _opencode_config() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "opencode" / "opencode.json"


def antigravity_allows() -> bool:
    """Whether Antigravity's own settings already let background runs call decomp's tools."""
    try:
        cfg = json.loads(agy_settings().read_text(encoding="utf-8"))
        allow = (cfg.get("permissions") or {}).get("allow") or []
        return isinstance(allow, list) and AGY_ALLOW in allow
    except (OSError, ValueError, AttributeError):
        return False


def allow_antigravity() -> bool:
    """Add the one rule Antigravity needs for decomp's tools, keeping every other permission and setting.
    A headless run cannot answer agy's permission prompt, so without this its MCP calls are denied."""
    path = agy_settings()
    try:
        cfg = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        return False
    if not isinstance(cfg, dict):
        return False
    permissions = cfg.setdefault("permissions", {})
    if not isinstance(permissions, dict):
        return False
    allow = permissions.setdefault("allow", [])
    if not isinstance(allow, list):
        return False
    if AGY_ALLOW not in allow:
        allow.append(AGY_ALLOW)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
        except OSError:
            return False
    return True


def commands(kind: str) -> list[str] | None:
    """The command that registers decomp.wtf with this agent (None: done through a config file)."""
    exe = _which(KINDS[kind].command) or KINDS[kind].command
    env = f"DECOMP_AGENT_NAME={LABEL[kind]}"
    bridge = bridge_command()
    if kind == "claude":
        return [exe, "mcp", "add", "-s", "user", NAME, "-e", env, "--", *bridge]  # -e takes several values: after the name
    if kind == "codex":
        return [exe, "mcp", "add", "--env", env, NAME, "--", *bridge]
    if kind == "antigravity":  # flags before the name; `--` because the bridge may be `python -m ...`
        return [exe, "mcp", "add", "-e", env, NAME, "--", *bridge]
    return None


def shown(kind: str) -> str:
    """The same, as text a user could run themselves."""
    cmd = commands(kind)
    if cmd is None:
        cfg = json.dumps(bridge_command())
        return f"add {{\"mcp\": {{\"decomp\": {{\"type\": \"local\", \"command\": {cfg}}}}}}} to {_opencode_config()}"
    return subprocess.list2cmdline([Path(cmd[0]).stem if sys.platform == "win32" else Path(cmd[0]).name, *cmd[1:]])


def status(kind: str) -> bool:
    """Whether decomp.wtf is already registered with this agent."""
    exe = _which(KINDS[kind].command)
    if not exe:
        return False
    try:
        if kind == "claude":
            return _run([exe, "mcp", "get", NAME], 30).returncode == 0
        if kind == "codex":
            return _run([exe, "mcp", "get", NAME], 30).returncode == 0
        if kind == "antigravity":  # a table: NAME TYPE STATUS COMMAND/URL
            return any(line.split()[:1] == [NAME] for line in _run([exe, "mcp", "list"], 30).stdout.splitlines())
        if kind == "opencode":
            mcp = json.loads(_opencode_config().read_text(encoding="utf-8")).get("mcp") or {}
            return NAME in mcp or NAME in (mcp.get("servers") or {})  # OpenCode 2's shape, or the one before
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False
    return False


def connect(kind: str) -> str:
    """Register decomp.wtf with the agent. Returns what happened, for the user."""
    kind = kind_id(kind)
    if kind not in LABEL:
        raise ValueError(f"unknown agent {kind!r}")
    if not _which(KINDS[kind].command):
        raise ValueError(f"{KINDS[kind].name} isn't installed")
    if kind == "opencode":
        path = _opencode_config()
        try:
            cfg = (json.loads(path.read_text(encoding="utf-8")) if path.exists()
                   else {"$schema": "https://opencode.ai/config.json"})
        except ValueError:
            raise ValueError(f"{path} isn't plain JSON (comments?); add this yourself: {shown(kind)}") from None
        entry = {"type": "local", "command": bridge_command(), "environment": {"DECOMP_AGENT_NAME": LABEL[kind]}}
        mcp = cfg.setdefault("mcp", {})
        if "servers" in mcp:  # a file in OpenCode 2's shape (OpenCode 2 still reads the earlier one)
            mcp["servers"][NAME] = entry
        else:
            mcp[NAME] = {**entry, "enabled": True}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
        return f"added decomp.wtf to {path}"
    cmd = commands(kind)
    if kind != "antigravity" and status(kind):  # replace an older registration (agy's `mcp add` updates in place)
        _run([cmd[0], "mcp", "remove", *(["-s", "user"] if kind == "claude" else []), NAME], 30)
    res = _run(cmd, 60)
    if res.returncode != 0:
        raise ValueError(f"{KINDS[kind].name} said: {(res.stderr or res.stdout).strip()[-300:]}")
    if kind == "antigravity":
        allow_antigravity()  # background helpers cannot answer agy's permission prompt
    return (res.stdout or res.stderr).strip()[-300:] or "connected"
