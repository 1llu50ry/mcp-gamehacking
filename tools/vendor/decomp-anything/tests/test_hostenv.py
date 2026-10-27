"""decomp.wtf in WSL (Windows) and Docker (macOS): paths the user gives on their own computer, and what the app can
and can't do from inside (open the browser, show a folder, how the user's agents reach it)."""

import pytest

from decompnet import hostenv, toolchains


@pytest.fixture
def runtime(monkeypatch):
    def use(rt: str, **env):
        monkeypatch.setenv("DECOMP_RUNTIME", rt)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        hostenv.runtime.cache_clear()
    yield use
    hostenv.runtime.cache_clear()


def test_windows_paths_reach_the_game_from_wsl(runtime, monkeypatch):
    runtime("wsl")
    monkeypatch.setattr(hostenv.subprocess, "run", _no_wslpath)
    assert str(hostenv.local_path(r"C:\Users\Sam Wolfs\Games\mp6.rvz")) == "/mnt/c/Users/Sam Wolfs/Games/mp6.rvz"
    assert str(hostenv.local_path('"D:/roms/game.z64"')) == "/mnt/d/roms/game.z64"  # quoted, forward slashes
    assert str(hostenv.local_path(r"\\wsl.localhost\decomp-wtf\home\decomp\game.z64")) == "/home/decomp/game.z64"
    assert str(hostenv.local_path("/home/decomp/x.z64")) == "/home/decomp/x.z64"  # Linux paths stay
    assert hostenv.host_os() == "windows"


def test_wsl_paths_shown_to_windows(runtime, monkeypatch):
    runtime("wsl", WSL_DISTRO_NAME="decomp-wtf")
    monkeypatch.setattr(hostenv.subprocess, "run", _no_wslpath)
    assert hostenv.shown_path("/home/decomp/Decomp") == r"\\wsl.localhost\decomp-wtf\home\decomp\Decomp"
    assert hostenv.windows_path("/mnt/c/Users/x") == r"C:\Users\x"
    bridge = hostenv.host_bridge()
    assert bridge[0] == "wsl.exe" and bridge[-2:] == ["/usr/local/bin/decomp", "mcp"] and "decomp-wtf" in bridge


def test_docker_home_is_the_users_home(runtime):
    runtime("docker", DECOMP_HOST_HOME="/Users/sam", DECOMP_HOST_OS="macos")
    assert str(hostenv.local_path("~/Downloads/game.iso")) == "/Users/sam/Downloads/game.iso"
    assert str(hostenv.local_path("/Users/sam/x.z64")) == "/Users/sam/x.z64"
    assert hostenv.open_url("http://127.0.0.1:1/") is False  # the computer opens the browser, not the container
    assert "docker cp" in hostenv.open_folder(hostenv.Path("/home/decomp/Decomp/p"))
    assert hostenv.host_bridge() == ["/Users/sam/.local/bin/decomp", "mcp"]
    assert hostenv.host_os() == "macos"


def test_native_changes_nothing(runtime):
    runtime("native")
    assert hostenv.host_bridge() is None
    assert hostenv.terminal_hint() == "Open a terminal"
    assert str(hostenv.local_path("~/x")).endswith("/x") and "~" not in str(hostenv.local_path("~/x"))


def test_agent_signin_says_where_to_sign_in(runtime):
    from decompnet.app import agents

    runtime("native")
    assert agents.signin(agents.KINDS["claude"]) == agents.KINDS["claude"].signin
    runtime("wsl")
    text = agents.signin(agents.KINDS["claude"])
    assert "decomp shell" in text and "/login" in text


def _no_wslpath(*args, **kwargs):  # this test machine has no WSL
    raise FileNotFoundError("wslpath")


@pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None, reason="needs gcc-2.7.2-kmc")
def test_compiles_when_the_app_runs_from_root(monkeypatch):
    """A service or a container starts decomp.wtf in /, and there's no bwrap in decomp.wtf's own Linux: KMC GCC's
    assembler can't read its input from there, so every compile runs in its own work folder."""
    from decompnet import compiler, project

    monkeypatch.chdir("/")
    cfg = project.compiler_config(hostenv.Path("/tmp"), {"compiler": {"toolchain": "gcc-2.7.2-kmc", "sandbox": "none"}})
    res = compiler.compile_source(cfg, "", "int f(int v) { return v < 0 ? -v : v; }", trusted=True)
    assert res.ok, res.log
