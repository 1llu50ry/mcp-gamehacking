#!/usr/bin/env python3
"""Sandboxed end-to-end test of the ai-memory Claude Code plugin (#1166).

Run with:

    uv run --no-project python tests/e2e/claude_plugin_smoke.py \
      --ai-memory-bin /absolute/ai-memory \
      --plugin-dir plugins/claude-code

It needs the `claude` CLI on PATH and no Claude credentials: Claude Code runs
plugin hooks in `claude -p` even when it is not logged in, so SessionStart,
UserPromptSubmit and SessionEnd fire without a model turn. Tool events need a
model and are covered one level down by the CLI suite's launcher tests.

Every process runs in a scratch HOME and CLAUDE_CONFIG_DIR with a minimal,
synthetic environment: nothing reads or writes the operator's own agent
configuration or ai-memory install, and the server binds a free loopback
port. Scenarios:

1. the plugin alone delivers session-start, user-prompt and session-end for
   agent claude-code into the workspace/project the fixture marker names;
2. with a settings-file ai-memory hook for UserPromptSubmit also installed,
   each event is captured once: the settings copy is kept and the plugin
   copy dropped, while events the settings file does not wire still arrive
   through the plugin;
3. with no reachable binary, the plugin sends nothing and Claude still exits;
4. the repository's marketplace catalog loads (`claude plugin marketplace
   add <repo>`).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

WORKSPACE = "plugin-e2e"
PROJECT = "fixture"


class SmokeFailure(RuntimeError):
    """An assertion failed."""


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Sandbox:
    def __init__(self, root: Path, binary: Path, plugin_dir: Path) -> None:
        self.root = root
        self.binary = binary
        self.plugin_dir = plugin_dir
        self.home = root / "home"
        self.claude_dir = self.home / ".claude"
        self.data = root / "data"
        self.repo = root / "repo"
        self.url = ""
        self.server: subprocess.Popen[bytes] | None = None
        claude = shutil.which("claude")
        if claude is None:
            raise SmokeFailure("the claude CLI is not on PATH")
        # Only the claude CLI's own directory and the system tools: never a
        # developer's ~/.local/bin, where a real ai-memory may live.
        self.path = os.pathsep.join(
            [str(Path(os.path.realpath(claude)).parent), str(Path(claude).parent), "/usr/bin", "/bin"]
        )
        for directory in (self.claude_dir, self.data, self.repo):
            directory.mkdir(parents=True, exist_ok=True)

    def env(self, **extra: str) -> dict[str, str]:
        env = {
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
            "PATH": self.path,
            "LANG": "C.UTF-8",
            "TERM": "dumb",
            "CLAUDE_CONFIG_DIR": str(self.claude_dir),
            # No update checks or other background traffic from the CLI.
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
        env.update(extra)
        return env

    def start_server(self) -> None:
        port = free_port()
        self.url = f"http://127.0.0.1:{port}"
        log = open(self.root / "serve.log", "wb")  # noqa: SIM115 - closed with the process
        self.server = subprocess.Popen(
            [str(self.binary), "serve", "--transport", "http", "--bind", f"127.0.0.1:{port}", "--no-watcher"],
            env=self.env(
                AI_MEMORY_DATA_DIR=str(self.data),
                AI_MEMORY_EMBEDDING_PROVIDER="none",
                AI_MEMORY_BACKFILL_ON_START="false",
                AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED="false",
                RUST_LOG="off",
            ),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
        )
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.server.poll() is not None:
                raise SmokeFailure("ai-memory serve exited early; see serve.log")
            with contextlib.suppress(OSError):
                with urllib.request.urlopen(f"{self.url}/healthz", timeout=2) as response:
                    if response.status == 200:
                        return
            time.sleep(0.2)
        raise SmokeFailure("ai-memory serve never answered /healthz")

    def stop_server(self) -> None:
        if self.server is not None:
            self.server.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.server.wait(timeout=10)
            if self.server.poll() is None:
                self.server.kill()

    def write_fixture_repo(self) -> None:
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True, env=self.env())
        (self.repo / ".ai-memory.toml").write_text(
            f'workspace = "{WORKSPACE}"\nproject = "{PROJECT}"\n', encoding="utf-8"
        )

    def write_settings(self, *, binary: str, settings_hook: bool) -> None:
        # Options for a --plugin-dir plugin live under the id "ai-memory@inline".
        settings: dict[str, object] = {
            "pluginConfigs": {
                "ai-memory@inline": {
                    "options": {"server_url": self.url, "ai_memory_bin": binary, "data_dir": str(self.data)}
                }
            }
        }
        if settings_hook:
            command = (
                f'"{self.binary}" hook --event user-prompt-submit --agent claude-code '
                f'--server-url {self.url} --data-dir "{self.data}"'
            )
            settings["hooks"] = {
                "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": command}]}]
            }
        (self.claude_dir / "settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")

    def run_claude(self, prompt: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["claude", "-p", prompt, "--plugin-dir", str(self.plugin_dir)],
            cwd=self.repo,
            env=self.env(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )

    def sessions(self) -> list[tuple[bytes, str, str, str, bool]]:
        path = self.data / "db" / "memory.sqlite"
        if not path.exists():
            return []
        with contextlib.closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as db:
            return list(
                db.execute(
                    "SELECT s.id, s.agent_kind, w.name, p.name, s.ended_at IS NOT NULL FROM sessions s "
                    "JOIN projects p ON p.id = s.project_id JOIN workspaces w ON w.id = s.workspace_id "
                    "ORDER BY s.started_at"
                )
            )

    def kinds(self, session_id: bytes) -> list[str]:
        path = self.data / "db" / "memory.sqlite"
        with contextlib.closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as db:
            return [
                row[0]
                for row in db.execute(
                    "SELECT kind FROM observations WHERE session_id = ? ORDER BY created_at, rowid", (session_id,)
                )
            ]

    def wait_for_sessions(self, count: int) -> list[tuple[bytes, str, str, str, bool]]:
        """Session-end hands the drain to a detached process: wait for it."""
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            sessions = self.sessions()
            if len(sessions) >= count and all(ended for *_, ended in sessions):
                return sessions
            time.sleep(0.25)
        raise SmokeFailure(f"expected {count} completed session(s), saw {self.sessions()!r}")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def scenario_plugin_alone(box: Sandbox) -> None:
    box.write_settings(binary=str(box.binary), settings_hook=False)
    box.run_claude("first prompt")
    sessions = box.wait_for_sessions(1)
    session_id, agent, workspace, project, _ = sessions[0]
    check(agent == "claude-code", f"agent was {agent}")
    check((workspace, project) == (WORKSPACE, PROJECT), f"scope was {workspace}/{project}")
    kinds = box.kinds(session_id)
    for kind in ("session-start", "user-prompt", "session-end"):
        check(kinds.count(kind) == 1, f"plugin alone: {kind} x{kinds.count(kind)} in {kinds}")
    print("ok: plugin alone captured session-start, user-prompt, session-end into the marker's scope")


def scenario_settings_hook_wins(box: Sandbox) -> None:
    box.write_settings(binary=str(box.binary), settings_hook=True)
    box.run_claude("second prompt")
    sessions = box.wait_for_sessions(2)
    kinds = box.kinds(sessions[1][0])
    check(kinds.count("user-prompt") == 1, f"settings + plugin: user-prompt x{kinds.count('user-prompt')} in {kinds}")
    check(kinds.count("session-start") == 1, f"plugin still delivers session-start: {kinds}")
    check(kinds.count("session-end") == 1, f"plugin still delivers session-end: {kinds}")
    print("ok: settings hook and plugin together captured each event once")


def scenario_missing_binary(box: Sandbox) -> None:
    before = len(box.sessions())
    box.write_settings(binary=str(box.root / "no-such-ai-memory"), settings_hook=False)
    result = box.run_claude("third prompt")
    check(result.returncode is not None, "claude did not exit")
    time.sleep(3)
    check(len(box.sessions()) == before, "a session was captured without a reachable binary")
    spool = box.data / "hook-spool"
    check(not any(spool.rglob("*.json")) if spool.exists() else True, "events were spooled without a binary")
    print("ok: without a binary nothing was captured and claude exited")


def scenario_catalog_loads(box: Sandbox, repo_root: Path) -> None:
    result = subprocess.run(
        ["claude", "plugin", "marketplace", "add", str(repo_root)],
        env=box.env(),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    check(result.returncode == 0, f"marketplace add failed: {result.stdout}{result.stderr}")
    listed = subprocess.run(
        ["claude", "plugin", "marketplace", "list"],
        env=box.env(),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    check("ai-memory" in listed.stdout, f"catalog not listed: {listed.stdout}{listed.stderr}")
    print("ok: the repository catalog loads as marketplace ai-memory")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ai-memory-bin", required=True, type=Path)
    parser.add_argument("--plugin-dir", required=True, type=Path)
    parser.add_argument("--repo-root", type=Path, help="also check that the catalog at this root loads")
    parser.add_argument("--artifacts-parent", type=Path, help="keep the sandbox under this directory")
    args = parser.parse_args()

    binary = args.ai_memory_bin.resolve()
    plugin_dir = args.plugin_dir.resolve()
    parent = args.artifacts_parent.resolve() if args.artifacts_parent else None
    root = Path(tempfile.mkdtemp(prefix="ai-memory-plugin-e2e-", dir=parent))
    box = Sandbox(root, binary, plugin_dir)
    try:
        box.start_server()
        box.write_fixture_repo()
        scenario_plugin_alone(box)
        scenario_settings_hook_wins(box)
        scenario_missing_binary(box)
        if args.repo_root:
            scenario_catalog_loads(box, args.repo_root.resolve())
    except SmokeFailure as failure:
        print(f"FAIL: {failure} (sandbox kept at {root})", file=sys.stderr)
        return 1
    finally:
        box.stop_server()
    if parent is None:
        shutil.rmtree(root, ignore_errors=True)
    print("claude plugin smoke: all scenarios passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
