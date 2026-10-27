"""decomp.wtf on Windows as on Linux: agents started through npm's .cmd launchers, stopping an agent with everything it
started, UTF-8 output and files, HTTPS, startup apps, dtk's build paths."""

import contextlib
import json
import os
import shutil
import subprocess
import sys
import time

import pytest

from decompnet.app import agents, connect, service
from decompnet.forks.project import ForkProject

WIN = sys.platform == "win32"
windows = pytest.mark.skipif(not WIN, reason="Windows only")

# what npm writes for an agent on Windows (cmd-shim), pointing at node_modules\fake-agent\cli.js
SHIM = ('@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\n'
        'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n'
        '  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & '
        '"%_prog%"  "%dp0%\\node_modules\\fake-agent\\cli.js" %*\r\n')


def fake_npm_agent(tmp_path, monkeypatch, code: str):
    """An npm-installed agent whose cli.js is Python (run by this Python standing in for node)."""
    script = tmp_path / "node_modules" / "fake-agent" / "cli.js"
    script.parent.mkdir(parents=True)
    script.write_text(code, encoding="utf-8")
    (tmp_path / "fake-agent.cmd").write_text(SHIM, encoding="utf-8")
    which = agents.shutil.which
    monkeypatch.setattr(agents.shutil, "which", lambda cmd, path=None: sys.executable if cmd == "node" else which(cmd, path=path))
    return tmp_path / "fake-agent.cmd", script


@windows
def test_npm_agents_get_the_whole_prompt(tmp_path, monkeypatch):
    """cmd.exe would cut the prompt at its first line break (and the flags after it) and run what follows a &."""
    shim, script = fake_npm_agent(tmp_path, monkeypatch, "import json, sys\nprint(json.dumps(sys.argv[1:]))\n")
    prompt = 'Decompile "this".\nSecond line & echo INJECTED | more\n100% done ^ <ok> → ✓'
    cmd = agents.argv([str(shim), "-p", prompt, "-o", "stream-json"])
    assert cmd[:2] == [sys.executable, str(script)]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout.decode("utf-8")
    assert json.loads(out) == ["-p", prompt, "-o", "stream-json"]


@windows
def test_agents_connect_through_npm_launchers(tmp_path, monkeypatch):
    shim, _ = fake_npm_agent(tmp_path, monkeypatch, (
        "import json, pathlib, sys\n"
        "log = pathlib.Path(__file__).with_name('calls.json')\n"
        "log.write_text(json.dumps((json.loads(log.read_text()) if log.exists() else []) + [sys.argv[1:]]))\n"
        "sys.exit(1 if sys.argv[1:3] == ['mcp', 'get'] else 0)\n"))
    monkeypatch.setattr(connect, "_which", lambda cmd: str(shim))
    connect.connect("codex")
    calls = json.loads((shim.parent / "node_modules" / "fake-agent" / "calls.json").read_text(encoding="utf-8"))
    add = calls[-1]
    assert add[:4] == ["mcp", "add", "--env", "DECOMP_AGENT_NAME=codex"] and add[4:6] == ["decomp", "--"]
    assert add[-1] == "mcp"


@windows
def test_npm_agents_are_found_by_their_cmd(tmp_path, monkeypatch):
    npm = tmp_path / "npm"
    npm.mkdir()
    (npm / "fake-agent").write_text("#!/bin/sh\n")  # npm's launcher for Git Bash: Windows can't start it
    (npm / "fake-agent.cmd").write_text("@echo off\n")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    monkeypatch.setattr(agents, "search_path", lambda: str(tmp_path / "nothing-here"))
    assert agents._which("fake-agent") == str(npm / "fake-agent.cmd")


@pytest.mark.skipif(WIN, reason="the rest of the world")
def test_commands_stay_as_they_are_elsewhere():
    assert agents.search_path() is None
    assert agents.argv(["agent.cmd", "-p", "a\nb"]) == ["agent.cmd", "-p", "a\nb"]


def _alive(pid: int) -> bool:
    if WIN:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def test_stopping_an_agent_stops_what_it_started(tmp_path):
    pidfile = tmp_path / "child.pid"
    code = ("import subprocess, sys, time\n"
            "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            f"open({str(pidfile)!r}, 'w').write(str(p.pid))\n"
            "time.sleep(60)\n")
    proc = subprocess.Popen([sys.executable, "-c", code], creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if WIN else 0,
                            start_new_session=not WIN)
    for _ in range(100):
        if pidfile.exists() and pidfile.read_text():
            break
        time.sleep(0.1)
    child = int(pidfile.read_text())
    agents._terminate(proc)
    proc.wait(10)
    for _ in range(50):
        if not _alive(child):
            break
        time.sleep(0.1)
    assert not _alive(child)


def test_output_into_a_pipe_is_utf8():
    res = subprocess.run([sys.executable, "-I", "-c", "import decompnet; decompnet.utf8_output(); print('→ ✓ 🎉')"],
                         capture_output=True)
    assert res.returncode == 0 and res.stdout.decode("utf-8").strip() == "→ ✓ 🎉"


def test_the_guides_reach_agents_intact():
    from decompnet.app import tools

    text = tools._guide("fork")
    assert "…" in text and "â€" not in text


@windows
def test_https_is_verified_by_windows():
    import ssl

    import decompnet  # noqa: F401

    assert ssl.SSLContext.__module__.startswith("truststore")


@windows
def test_running_at_log_on_needs_no_administrator(monkeypatch):
    import winreg

    key = r"Software\decomp.wtf-tests\Run"
    monkeypatch.setattr(service, "RUN_KEY", key)
    started = []
    monkeypatch.setattr(service.subprocess, "Popen", lambda cmd, **kw: started.append(cmd))
    monkeypatch.setattr(service.subprocess, "run", lambda *a, **kw: subprocess.CompletedProcess(a, 1))
    try:
        assert "startup apps" in service.install() and service.installed()
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            value = winreg.QueryValueEx(k, service.RUN_NAME)[0]
        assert "pythonw.exe" in value.lower() and "decompnet.app.cli" in value and started
        service.remove()
        assert not service.installed()
    finally:
        for k in (key, r"Software\decomp.wtf-tests"):
            with contextlib.suppress(OSError):
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, k)


def test_builds_find_decomp_wtfs_own_ninja(tmp_path, monkeypatch):
    """ninja comes in decomp.wtf's own environment, which isn't on PATH once decomp.wtf is installed (a GameCube game's
    first build ran `ninja`: on Windows it wasn't found)."""
    own = os.path.normcase(os.path.dirname(sys.executable))
    monkeypatch.setenv("PATH", os.pathsep.join(p for p in os.environ.get("PATH", "").split(os.pathsep)
                                               if os.path.normcase(p.rstrip("\\/")) != own))
    if shutil.which("ninja"):
        pytest.skip("another ninja is on PATH")
    ok, out = ForkProject(tmp_path).run(["ninja", "--version"], log=lambda *_: None)
    assert ok, out


@pytest.mark.parametrize("target", ["build/G1E751/ok", r"build\G1E751\ok"])
def test_the_checksum_target_is_found_with_either_slash(tmp_path, target):
    (tmp_path / "build.ninja").write_text(f"build {target}: check config/G1E751/build.sha1\n", encoding="utf-8")
    assert ForkProject(tmp_path).check_target() == target
