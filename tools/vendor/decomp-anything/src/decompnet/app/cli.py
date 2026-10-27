"""`decomp`: start decomp.anything (or bring the running one to the front) and open it in the browser."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .. import hostenv

DEFAULT_PORT = int(os.environ.get("DECOMP_PORT") or 6464)


def home_dir() -> Path:
    return Path(os.environ.get("DECOMP_HOME", Path.home() / "Decomp")).expanduser()


def _alive(port: int) -> bool:
    return _running_version(port) is not None


def _running_version(port: int) -> str | None:
    """The version of the decomp.anything answering on this port ("" when it doesn't say), or None."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.5) as r:
            data = json.loads(r.read())
            return str(data.get("version") or "") if data.get("app") in ("decomp-anything", "decomp-wtf") else None
    except (OSError, ValueError):
        return None


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def replace_older(state_file: Path, log=print) -> dict | None:
    """The running app's {port, secret} when it's this version or newer. An older one (still running after an
    upgrade) is stopped, so the new version starts in its place: returns None then, and when nothing runs. A newer
    app is never stopped by an older `decomp mcp` (an agent may still be set up with an older install's path)."""
    try:
        prev = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    running = _running_version(prev.get("port") or 0)
    if running is None:
        return None
    mine = __import__("decompnet").__version__
    if running == mine or _version_key(running) > _version_key(mine):
        return prev
    log(f"decomp.anything {running} is still running; restarting it as {mine}")
    req = urllib.request.Request(f"http://127.0.0.1:{prev['port']}/api/quit", method="POST", data=b"{}",
                                 headers={"Cookie": f"decomp_live={prev['secret']}", "X-Decomp": "1",
                                          "Host": f"127.0.0.1:{prev['port']}", "Content-Type": "application/json"})
    with contextlib.suppress(OSError):
        urllib.request.urlopen(req, timeout=10)
    for _ in range(100):
        if _running_version(prev["port"]) is None:
            break
        time.sleep(0.1)
    return None


def _bind_address() -> str:
    """127.0.0.1, except in decomp.anything's Docker container: there the published port (127.0.0.1 on the computer
    itself) arrives from outside the container. Host headers are still checked on every request (server.py)."""
    return os.environ.get("DECOMP_BIND") or ("0.0.0.0" if hostenv.runtime() == "docker" else "127.0.0.1")


def _listen(start: int, exact: bool = False) -> socket.socket:
    """A listening socket on the first free port from `start`, kept open and handed to the server: two decomp.anything
    instances starting at the same moment can't both pick the same port. `exact`: that port or nothing (a restart
    into an update keeps its port, so the open browser tab carries on; Docker publishes one port)."""
    for port in range(start, start + (1 if exact else 50)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sys.platform != "win32":  # the previous run's connections may linger in TIME_WAIT for a minute
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        for _ in range(50 if exact else 1):
            try:
                sock.bind((_bind_address(), port))
                sock.listen(128)
                return sock
            except OSError:
                time.sleep(0.2 if exact else 0)
        sock.close()
    raise SystemExit(f"port {start} is taken" if exact else "no free port for decomp.anything")


def _open_when_ready(url: str, port: int) -> None:
    def wait():
        for _ in range(100):
            if _alive(port):
                hostenv.open_url(url)
                return
            time.sleep(0.2)
    threading.Thread(target=wait, daemon=True).start()


def _agent_secret(internal: Path) -> str:
    """The install's local-agent secret (0600). Stable across restarts so helpers' MCP bridges keep their identity."""
    path = internal / "agent.secret"
    try:
        secret = path.read_text(encoding="utf-8").strip()
    except OSError:
        secret = ""
    if not secret:
        secret = secrets.token_urlsafe(32)
        path.write_text(secret + "\n", encoding="utf-8")
        with contextlib.suppress(OSError):
            os.chmod(path, 0o600)
    return secret


def _restart_state() -> dict | None:
    """Set by updates.restart: this process just became the new version and keeps the old one's port and secret."""
    raw = os.environ.pop("DECOMP_RESTART", "")
    try:
        data = json.loads(raw) if raw else None
        return data if isinstance(data, dict) and data.get("port") and data.get("secret") else None
    except ValueError:
        return None


def run(args) -> int:
    import uvicorn

    from .engine import RomNetwork
    from .server import build

    home = home_dir()
    internal = home / ".decomp"
    internal.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None:  # started without a console (pythonw: Windows' startup apps): what it says goes to app.log
        log = open(internal / "app.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115 the process's own log
        sys.stdout = sys.stderr = log
    state_file = internal / "server.json"
    restarted = _restart_state()
    prev = None if restarted else replace_older(state_file)
    if prev:
        url = f"http://127.0.0.1:{prev['port']}/?k={prev['secret']}"
        print(f"decomp.anything is already running: {url}")
        if not args.no_browser and not hostenv.open_url(url):
            print("open that address in your browser")
        return 0

    sock = _listen(restarted["port"] if restarted else args.port, exact=bool(restarted) or _fixed_port())
    port = sock.getsockname()[1]
    secret = restarted["secret"] if restarted else secrets.token_urlsafe(24)
    state_file.write_text(json.dumps({"port": port, "secret": secret, "pid": os.getpid()}), encoding="utf-8")
    with contextlib.suppress(OSError):
        os.chmod(state_file, 0o600)
    net = RomNetwork(internal / "decomp.db", home, agent_secret=_agent_secret(internal))
    mcp, manager, security = build(net, internal, port, secret)
    app = mcp.streamable_http_app(transport_security=security, max_request_body_size=80 * 1024 * 1024, host="127.0.0.1")
    url = f"http://127.0.0.1:{port}/?k={secret}"
    print(f"decomp.anything {__import__('decompnet').__version__} on {url}\nyour projects: {hostenv.shown_path(home)}"
          + ("\nupdated and restarted" if restarted else "\nstop with Ctrl-C"), flush=True)
    if not args.no_browser and not restarted:
        _open_when_ready(url, port)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    finally:
        manager.stop()
        manager.on_stop()
    return 0


def _fixed_port() -> bool:
    """Docker publishes exactly one port: decomp.anything must listen on it, not on the next free one."""
    return hostenv.runtime() == "docker" and bool(os.environ.get("DECOMP_PORT"))


def url_cmd(args) -> int:
    """Print the address that opens the app (starting it in the background first if needed)."""
    from .bridge import ensure_app

    info = ensure_app(home_dir())
    print(f"http://127.0.0.1:{info['port']}/?k={info['secret']}")
    return 0


def update_cmd(args) -> int:
    """Look for a newer decomp.anything and install it (the running app restarts into it)."""
    from . import updates

    state_file = home_dir() / ".decomp" / "server.json"
    running = None
    try:
        running = json.loads(state_file.read_text(encoding="utf-8"))
        if not _alive(running.get("port", 0)):
            running = None
    except (OSError, ValueError):
        pass
    found = updates.check()
    cur = found["current"]
    where = f" ({cur['branch']} @ {(cur.get('commit') or '?')[:7]})" if cur["channel"] == "branch" else ""
    if found.get("error"):
        print(found["error"])
        return 1
    if not found["available"]:
        print(f"decomp.anything {cur['version']}{where} is up to date")
        return 0
    latest = found["latest"]
    print(f"update: {latest.get('version') or ''} {('@ ' + latest['commit'][:7]) if latest.get('commit') else ''}".strip())
    for note in found.get("notes") or []:
        print(f"  - {note}")
    if args.check:
        return 0
    if running:  # the app installs it and restarts itself (its page follows along)
        _api("/api/update", {"apply": True})
        print("decomp.anything is installing the update and restarts when it's done")
        return 0
    updates.install(found, log=print)
    print("updated")
    return 0


def install_info(args) -> int:
    """Remember how decomp.anything was installed (by the installers): where its updates come from."""
    from . import updates

    print(json.dumps(updates.record(args.channel, args.branch, args.commit, args.repo)))
    return 0


def setup(args) -> int:
    """Install what decomp.anything needs on this computer: the free compilers and the draft decompiler."""
    from .. import toolchains
    from . import agents

    plat = toolchains.current_platform()
    print(f"Setting up decomp.anything tools for {plat}")
    if why := toolchains.unsupported_cpu():
        print(f"  ! {why}: the games can be imported and looked at here, not matched")
    for tid in ("gcc-2.7.2-kmc", "m2c", "objdiff-cli"):
        tc = toolchains.get(tid)
        if not tc.supported:
            print(f"  - {tc.name}: no build for {plat} (projects that need it can't be matched here yet)")
            continue
        try:
            toolchains.install(tid, log=lambda line: print(f"  {line}"))
        except Exception as e:  # noqa: BLE001 keep going: the app shows what's missing
            print(f"  ! {tc.name}: {e}")
    print("  IDO (most first-party games) is proprietary: install it from the app if you accept its license.")
    found = [a["name"] for a in agents.detect() if a["installed"] and a["id"] != "api"]
    print("AI agents found: " + (", ".join(found) if found else "none yet (the app helps you add one)"))
    return 0


def stop(args) -> int:
    state_file = home_dir() / ".decomp" / "server.json"
    try:
        prev = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print("decomp.anything is not running")
        return 0
    if not _alive(prev.get("port", 0)):
        print("decomp.anything is not running")
        return 0
    req = urllib.request.Request(f"http://127.0.0.1:{prev['port']}/api/quit", method="POST", data=b"{}",
                                 headers={"Cookie": f"decomp_live={prev['secret']}", "X-Decomp": "1",
                                          "Host": f"127.0.0.1:{prev['port']}", "Content-Type": "application/json"})
    with contextlib.suppress(OSError):
        urllib.request.urlopen(req, timeout=5)
    print("decomp.anything stopped")
    return 0


def connect_agents(args) -> int:
    """Give the AI agents you use decomp.anything's tools: then ask them to decompile your game."""
    from . import agents, connect

    if "gemini" in args.agents:
        print("Gemini CLI was retired by Google; its successor is Antigravity CLI (agy): connecting that instead.")
    args.agents = [agents.kind_id(a) for a in args.agents]
    unknown = [a for a in args.agents if a not in connect.LABEL]
    if unknown:
        print(f"unknown agent {unknown[0]!r}: use claude, codex, antigravity or opencode")
        return 2
    found = [a for a in agents.detect() if a["id"] in connect.LABEL and a["installed"]]
    wanted = [a for a in found if not args.agents or a["id"] in args.agents]
    if not found:
        print("No agent CLI found (Claude Code, Codex, Antigravity CLI or opencode). Install one, then run `decomp connect`.")
        return 1
    for a in wanted:
        if args.list:
            print(f"{a['name']}: {'connected' if connect.status(a['id']) else 'not connected'}")
            continue
        try:
            connect.connect(a["id"])
            print(f"{a['name']}: connected")
        except (ValueError, OSError) as e:
            print(f"{a['name']}: {e}")
    if not args.list:
        print('Now ask your agent, for example: "decompile my game at ~/roms/game.z64"')
    return 0


def _api(path: str, body: dict | None = None) -> dict:
    """Call the running app's API (for commands that act on it, like `decomp share`)."""
    state = home_dir() / ".decomp" / "server.json"
    try:
        info = json.loads(state.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SystemExit("decomp.anything isn't running: start it with `decomp --no-browser`") from None
    if not _alive(info.get("port", 0)):
        raise SystemExit("decomp.anything isn't running: start it with `decomp --no-browser`")
    req = urllib.request.Request(f"http://127.0.0.1:{info['port']}{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Cookie": f"decomp_live={info['secret']}", "X-Decomp": "1",
                                          "Host": f"127.0.0.1:{info['port']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(json.loads(e.read() or b"{}").get("error") or str(e)) from None


def _wait(job: str, what: str) -> dict:
    last = ""
    for _ in range(7200):
        st = _api(f"/api/job?id={job}")
        if st["log"] and st["log"][-1] != last:
            last = st["log"][-1]
            print(f"  {last}")
        if st["state"] != "running":
            break
        time.sleep(0.5)
    if st["state"] != "done":
        raise SystemExit(st.get("error") or f"{what} failed")
    return st["result"]


def host(args) -> int:
    """One command for a home PC or a server: run decomp.anything in the background, import your copy of the game and open
    a room for your team. Prints the invite link."""
    from .bridge import ensure_app

    game = Path(args.game).expanduser()
    if not game.is_file():
        raise SystemExit(f"no file at {game}")
    if not args.own_copy:
        if not sys.stdin.isatty():
            raise SystemExit("confirm that this is your own legally obtained copy of the game: add --own-copy")
        if input(f"Is {game.name} your own legally obtained copy of the game? [y/N] ").strip().lower() not in ("y", "yes"):
            raise SystemExit("decomp.anything only works with your own copy of a game")
    if args.service:
        from . import service

        print(service.install())
    ensure_app(home_dir())
    print(f"importing {game.name}")
    slug = _wait(_api(f"/api/import?confirmed=1&path={urllib.parse.quote(str(game))}", {})["job"], "importing")["slug"]
    print(f"project: {slug}")
    args.project = slug
    return share(args)


def fork_cmd(args) -> int:
    """Work on an existing decomp project's source tree: decomp.anything copies the checkout, builds with the project's
    own toolchain and lets agents edit its real source files."""
    from .bridge import ensure_app

    path = Path(args.path).expanduser()
    if not path.is_dir():
        raise SystemExit(f"no folder at {path}")
    if not (path / ".git").exists():
        raise SystemExit(f"{path} isn't a git checkout. Run `cd {path} && git init && git add -A && "
                         f"git commit -m 'import existing source'`, then run this again.")
    info = ensure_app(home_dir())
    print(f"forking {path}")
    result = _wait(_api("/api/fork", {"repo": str(path.resolve()), "name": args.name})["job"], "forking")
    print(f"project: {result['slug']}")
    print(f"open: http://127.0.0.1:{info['port']}/?k={info['secret']}#/p/{result['slug']}")
    return 0


def join(args) -> int:
    """Join a team's room with your own copy of the game (decomp.anything starts in the background if needed)."""
    from .bridge import ensure_app

    game = Path(args.game).expanduser()
    if not game.is_file():
        raise SystemExit(f"no file at {game}")
    if not args.own_copy:
        if not sys.stdin.isatty():
            raise SystemExit("confirm that this is your own legally obtained copy of the game: add --own-copy")
        if input(f"Is {game.name} your own legally obtained copy of the game? [y/N] ").strip().lower() not in ("y", "yes"):
            raise SystemExit("decomp.anything only works with your own copy of a game")
    info = ensure_app(home_dir())
    q = urllib.parse.urlencode({"link": args.link, "name": args.name, "confirmed": "1", "path": str(game.resolve())})
    req = urllib.request.Request(f"http://127.0.0.1:{info['port']}/api/collab/join?{q}", method="POST",
                                 data=b"", headers={"Cookie": f"decomp_live={info['secret']}", "X-Decomp": "1",
                                                                  "Host": f"127.0.0.1:{info['port']}",
                                                                  "Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            job = json.loads(r.read())["job"]
    except urllib.error.HTTPError as e:
        raise SystemExit(json.loads(e.read() or b"{}").get("error") or str(e)) from None
    slug = _wait(job, "joining")["slug"]
    print(f"In the room as {args.name}: project {slug}. Start agents in the app, or ask your own agent (decomp connect).")
    return 0


def service_cmd(args) -> int:
    from . import service

    if args.action == "install":
        print(service.install())
    elif args.action == "remove":
        print(service.remove())
    else:
        print("decomp.anything runs as a service" if service.installed() else "decomp.anything doesn't run as a service")
    return 0


def share(args) -> int:
    """Share a project with a team from this computer or a server (decomp --no-browser keeps running)."""
    state = _api("/api/state")
    slugs = [p["slug"] for p in state["projects"]]
    if args.project not in slugs:
        raise SystemExit(f"no project {args.project!r}; projects here: {', '.join(slugs) or 'none'}")
    body = {"slug": args.project, "visibility": "public" if args.public else "private", "approve": args.approve,
            "mode": "address" if args.address else "tunnel", "address": args.address or "", "port": args.port}
    result = _wait(_api("/api/collab/start", body)["job"], "sharing")
    print(f"Sharing {args.project} ({body['visibility']}{', you approve each member' if args.approve else ''}).")
    print(f"Invite link: {result['link']}")
    print("Teammates open decomp.anything, choose Join a friend's room, paste the link and pick their own copy of the game.")
    return 0


def shortcut(args) -> int:
    from .launcher import install_launcher

    if hostenv.runtime() != "native":
        print("the installer adds decomp.anything to your computer's menu (this is decomp.anything's own Linux)")
        return 0

    print(install_launcher())
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="decomp", description="decomp.anything: your AI agents decompile your games, matching byte for byte")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true", help="don't open the browser")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("setup", help="install the compilers and tools this computer needs")
    sub.add_parser("start", help="start decomp.anything (the same as running decomp with no command)")
    sub.add_parser("stop", help="stop the running app")
    sub.add_parser("shortcut", help="add decomp.anything to your apps menu / desktop")
    sub.add_parser("url", help="print the address that opens the app (starts it if needed)")
    up = sub.add_parser("update", help="install the newest decomp.anything (the running app restarts into it)")
    up.add_argument("--check", action="store_true", help="only say whether there is one")
    ii = sub.add_parser("install-info", help=argparse.SUPPRESS)  # the installers: where updates come from
    ii.add_argument("--channel", choices=["release", "branch"], default="release")
    ii.add_argument("--branch", default="")
    ii.add_argument("--commit", default="")
    ii.add_argument("--repo", default="giveen/decomp.anything")
    c = sub.add_parser("connect", help="give your AI agents (Claude Code, Codex, Antigravity CLI, opencode) decomp.anything's tools")
    c.add_argument("agents", nargs="*", metavar="agent", help="claude, codex, antigravity (agy) or opencode (default: every one installed)")
    c.add_argument("--list", action="store_true", help="only show which are connected")
    sh = sub.add_parser("share", help="share a project with your team (the app must be running)")
    sh.add_argument("project", help="the project's slug (see the app, or `decomp share x` lists them)")
    sh.add_argument("--address", help="the address teammates use, e.g. http://my-server:6481 (default: a quick tunnel)")
    sh.add_argument("--port", type=int, default=6481, help="port for --address (default 6481)")
    sh.add_argument("--public", action="store_true", help="anyone with the address can join (default: invite link)")
    sh.add_argument("--approve", action="store_true", help="you let each new member in")
    ho = sub.add_parser("host", help="host a game for your team: import your copy and open a room (home PC or server)")
    ho.add_argument("game", help="your copy of the game (ROM, disc image or program file)")
    ho.add_argument("--own-copy", action="store_true", help="confirm it's your own legally obtained copy")
    ho.add_argument("--address", help="the address teammates use, e.g. http://my-server:6481 (default: a quick tunnel)")
    ho.add_argument("--port", type=int, default=6481, help="port for --address (default 6481)")
    ho.add_argument("--public", action="store_true", help="anyone with the address can join (default: invite link)")
    ho.add_argument("--approve", action="store_true", help="you let each new member in")
    ho.add_argument("--service", action="store_true", help="also run decomp.anything as a service that starts with the computer")
    fk = sub.add_parser("fork", help="work on an existing decomp project source tree (a git checkout)")
    fk.add_argument("path", help="the project's folder on this computer")
    fk.add_argument("--name", default="", help="what to call it (default: the folder's name)")
    jo = sub.add_parser("join", help="join a team's room with your own copy of the game")
    jo.add_argument("link", help="the invite link (or the room's address for a public room)")
    jo.add_argument("game", help="your copy of the same game")
    jo.add_argument("--name", required=True, help="your name in the room")
    jo.add_argument("--own-copy", action="store_true", help="confirm it's your own legally obtained copy")
    sv = sub.add_parser("service", help="run decomp.anything in the background, starting with the computer")
    sv.add_argument("action", choices=["install", "remove", "status"])
    m = sub.add_parser("mcp", help="serve decomp.anything to the AI agent you talk to (stdio MCP; starts the app if needed)")
    m.add_argument("--name", default=os.environ.get("DECOMP_AGENT_NAME") or "chat",
                   help="how this agent shows up in the app (e.g. claude-code; or set DECOMP_AGENT_NAME)")
    args = ap.parse_args(argv)
    __import__("decompnet").utf8_output()
    if args.cmd == "mcp":
        from .bridge import main as bridge
        return bridge(args.name)
    return {"start": run, "setup": setup, "stop": stop, "shortcut": shortcut, "connect": connect_agents, "share": share,
            "host": host, "join": join, "fork": fork_cmd, "service": service_cmd, "url": url_cmd, "update": update_cmd,
            "install-info": install_info}.get(args.cmd, run)(args)


if __name__ == "__main__":
    sys.exit(main())
