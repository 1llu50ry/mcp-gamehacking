"""Updates: decomp.wtf finds a newer version (a release, or new commits on the branch it was installed from), installs
it with uv and restarts in place. Offline: GitHub's and decomp.wtf's answers are stand-ins."""

import json
import os
import socket
import stat
import sys
import urllib.error

import pytest

from decompnet import __version__
from decompnet.app import updates


@pytest.fixture(autouse=True)
def data_home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    return tmp_path / "data"


def test_install_info_round_trip():
    assert updates.installed()["channel"] == "release"  # nothing recorded: a release install
    updates.record("branch", "cross-platform", "a" * 40)
    cur = updates.installed()
    assert (cur["channel"], cur["branch"], cur["commit"], cur["version"]) == ("branch", "cross-platform", "a" * 40, __version__)
    updates.record("release", "ignored", "ignored")
    assert updates.installed()["branch"] == "" and updates.installed()["commit"] == ""


def test_release_update(monkeypatch):
    newer = ".".join(str(x + (1 if i == 2 else 0)) for i, x in enumerate(updates.version_key(__version__)))
    monkeypatch.setattr(updates, "_get", lambda url, timeout=15: f'#!/bin/sh\nVERSION="{newer}"\n'.encode())
    found = updates.check()
    assert found["available"] and found["latest"]["version"] == newer and found["error"] is None
    assert found["spec"] == f"decompnet @ https://github.com/giveen/decomp.anything/archive/refs/tags/v{newer}.tar.gz"
    monkeypatch.setattr(updates, "_get", lambda url, timeout=15: f'VERSION="{__version__}"\n'.encode())
    assert not updates.check()["available"]


def test_branch_update(monkeypatch):
    have, head = "1" * 40, "2" * 40
    updates.record("branch", "cross-platform", have)
    answers = {
        "commits/cross-platform": {"sha": head, "commit": {"message": "Newest\n\nbody", "committer": {"date": "2026-10-14"}}},
        f"compare/{have}...{head}": {"status": "ahead", "commits": [{"commit": {"message": "Older one"}},
                                                                   {"commit": {"message": "Newest\n\nbody"}}]},
    }
    monkeypatch.setattr(updates, "_json", lambda url: next(v for k, v in answers.items() if url.endswith(k)))
    monkeypatch.setattr(updates, "_branch_version", lambda repo, sha: "0.10.0")
    found = updates.check()
    assert found["available"] and found["latest"]["commit"] == head and found["notes"] == ["Newest", "Older one"]
    assert found["spec"] == f"decompnet @ https://github.com/giveen/decomp.anything/archive/{head}.tar.gz"

    # installed from a commit newer than the branch (pushed elsewhere): not an "update"
    answers[f"compare/{have}...{head}"] = {"status": "behind", "commits": []}
    assert not updates.check()["available"]

    # a commit GitHub doesn't know (never pushed): the branch's newest is offered
    def unknown(url):
        if "compare" in url:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        return answers["commits/cross-platform"]
    monkeypatch.setattr(updates, "_json", unknown)
    found = updates.check()
    assert found["available"] and found["notes"] == ["Newest"]

    updates.record("branch", "cross-platform", head)
    assert not updates.check()["available"]


def test_offline_check_says_why(monkeypatch):
    def offline(url, timeout=15):
        raise urllib.error.URLError("no network")
    monkeypatch.setattr(updates, "_get", offline)
    found = updates.check()
    assert not found["available"] and "couldn't check" in found["error"]


@pytest.mark.skipif(sys.platform == "win32", reason="a shell script stands in for uv")
def test_install_runs_uv_then_the_new_setup(tmp_path, monkeypatch):
    calls = tmp_path / "calls"
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "decomp").write_text(f'#!/bin/sh\necho "decomp $*" >> "{calls}"\necho "tools ok"\n')
    uv = tmp_path / "uv"
    uv.write_text(f'#!/bin/sh\nif [ "$1 $2" = "tool dir" ]; then echo "{bindir}"; exit 0; fi\n'
                  f'echo "uv $*" >> "{calls}"\necho "Installed 1 executable: decomp"\n')
    for f in (uv, bindir / "decomp"):
        f.chmod(f.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(updates, "uv", lambda: str(uv))
    updates.record("branch", "cross-platform", "1" * 40)
    found = {"current": updates.installed(), "available": True, "latest": {"version": "0.10.0", "commit": "2" * 40},
             "spec": "decompnet @ https://github.com/giveen/decomp.anything/archive/" + "2" * 40 + ".tar.gz"}
    said = []
    updates.install(found, log=said.append)
    ran = calls.read_text().splitlines()
    assert ran[0] == f"uv tool install --force --python 3.12 {found['spec']}" and ran[1] == "decomp setup"
    assert any("tools ok" in s for s in said)
    assert json.loads(updates.info_file().read_text())["commit"] == "2" * 40  # the next check starts from here

    (bindir / "decomp").write_text("#!/bin/sh\necho broken >&2\nexit 3\n")
    with pytest.raises(RuntimeError, match="exit code 3"):
        updates.install(found, log=said.append)


def test_restart_keeps_port_and_secret(monkeypatch):
    from decompnet.app import cli

    monkeypatch.setenv("DECOMP_RESTART", json.dumps({"port": 6501, "secret": "abc"}))
    assert cli._restart_state() == {"port": 6501, "secret": "abc"}
    assert "DECOMP_RESTART" not in os.environ  # a later restart (or a child) doesn't inherit it
    monkeypatch.setenv("DECOMP_RESTART", "garbage")
    assert cli._restart_state() is None

    # the port the old process had is taken back exactly, also while connections from before linger
    first = cli._listen(0 + 6502, exact=True)
    port = first.getsockname()[1]
    peer = socket.create_connection(("127.0.0.1", port))
    conn, _ = first.accept()
    conn.close()  # the server side closes first: TIME_WAIT on the server's port
    peer.close()
    first.close()
    again = cli._listen(port, exact=True)
    assert again.getsockname()[1] == port
    again.close()


def test_update_api(tmp_path, monkeypatch):
    from starlette.testclient import TestClient

    from decompnet.app.engine import RomNetwork
    from decompnet.app.server import build

    monkeypatch.setattr(updates, "check", lambda: {"current": updates.installed(), "available": False, "latest": None,
                                                   "notes": [], "link": None, "error": None, "checked": 1e12,
                                                   "can_apply": True, "why_not": ""})
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6498, "sec")
    client = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                        base_url="http://127.0.0.1:6498")
    assert client.get("/api/update").status_code == 401  # the GUI's secret, as everywhere
    client.cookies.set("decomp_live", "sec")
    monkeypatch.setenv("DECOMP_UPDATES", "on")
    st = client.get("/api/update").json()
    assert st["available"] is False and st["job"]["state"] == "idle" and "runtime" in st
    r = client.post("/api/update", json={"apply": True}, headers={"X-Decomp": "1"})
    assert r.status_code == 400 and "up to date" in r.json()["error"]
    assert client.post("/api/settings", json={"check_updates": False}, headers={"X-Decomp": "1"}).json()["check_updates"] is False
    assert client.get("/api/update").json()["disabled"] is True
    health = client.get("/health").json()
    assert health["app"] == "decomp-anything" and "build" in health
