"""The local decomp.anything server: the GUI, its API, and the MCP endpoint agents connect to.

It listens on 127.0.0.1 only. The GUI needs a per-launch secret (handed to the browser in the URL the
app opens, then kept in a same-site cookie); agents need their own bearer token. Host headers are
checked on every request, so web pages can't reach it through DNS rebinding.
"""

from __future__ import annotations

import contextlib
import json
import logging
import logging.handlers
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid
from importlib import resources
from pathlib import Path

import anyio
from mcp.server.mcpserver import Context
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from .. import __version__, hostenv, rea, toolchains
from ..network import NetworkError
from ..rom.n64 import RomError
from . import agents, chat, collab, connect, tools, updates
from .console import Console, ConsoleError
from .engine import COMPILERS, MW_VERSIONS, PLATFORM_STATUS, SHORT_NAMES, TOOLS, RomNetwork

COOKIE = "decomp_live"
MAX_DISC = 16 * 1024 * 1024 * 1024  # dual-layer DVD and then some


def _analyze_instead(error: Exception) -> bool:
    """A file this app can't split as a game or match as a program: REA can still open it as a project."""
    text = str(error)
    return any(phrase in text for phrase in (
        "isn't a ROM, disc or game program", "isn't for x86/x86-64 Linux",
        "too big for a ROM and isn't a disc image"))


def file_log(path: Path) -> logging.Logger:
    """decomp.anything's own log (logs/decomp.log in its data folder): every job, what it said, and every error with its
    traceback, so a failed import can be reported with the whole story."""
    logger = logging.getLogger("decomp.anything")
    if not any(getattr(h, "baseFilename", None) == str(path) for h in logger.handlers):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = logging.handlers.RotatingFileHandler(path, maxBytes=2 << 20, backupCount=2, encoding="utf-8")
        except OSError:
            return logger
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


def _tool_of(cmd) -> str:
    """The program a command ran (past a systemd-run wrapper), by name."""
    argv = [str(a) for a in cmd] if isinstance(cmd, (list, tuple)) else str(cmd).split()
    if "--" in argv and Path(argv[0]).name.startswith("systemd-run"):
        argv = argv[argv.index("--") + 1:]
    return Path(argv[0]).name if argv else "a tool"


def job_error(e: BaseException, log_path: Path | None = None) -> str:
    """What to tell the user when a job fails: why, in words, for every kind of failure."""
    if isinstance(e, subprocess.TimeoutExpired):
        mins = max(1, round((e.timeout or 0) / 60))
        return (f"{_tool_of(e.cmd)} took longer than {mins} minute{'s' if mins != 1 else ''} and was stopped. "
                "A very big game can need more: please report it, with the log")
    if isinstance(e, subprocess.CalledProcessError):
        said = e.stderr or e.output or ""  # what the command said, so the error shows why
        said = (said.decode("utf-8", "replace") if isinstance(said, bytes) else said).strip()
        return f"{_tool_of(e.cmd)} failed ({e.returncode})" + (f": {said[-400:]}" if said else "")
    if isinstance(e, MemoryError):
        return "this computer ran out of memory: close other programs and try again"
    if isinstance(e, (NetworkError, RomError, toolchains.ToolchainError, ValueError, RuntimeError, OSError)):
        return str(e) or type(e).__name__
    where = f" (the log: {hostenv.shown_path(log_path)})" if log_path else ""
    return (f"something went wrong inside decomp.anything ({type(e).__name__}: {e}). That's a bug: please report it with "
            f"the log{where}")


class Jobs:
    """Background work the GUI can follow: imports and installs. A job always ends: done, or an error that says why
    (never `running` forever because of an error nobody caught). Everything goes to the log file too."""

    def __init__(self, log_path: Path | None = None):
        self.jobs: dict[str, dict] = {}
        # jid -> event set when the job ends. Kept beside `jobs`, not inside it: job dicts are JSON to the GUI.
        self.done: dict[str, threading.Event] = {}
        self.log_path = log_path
        self.logger = file_log(log_path) if log_path else logging.getLogger("decomp.anything")

    def start(self, kind: str, fn) -> str:
        jid = uuid.uuid4().hex[:12]
        event = threading.Event()  # async watchers wait on this instead of polling the dict every 0.5s
        job = {"id": jid, "kind": kind, "state": "running", "log": [], "result": None, "error": None, "t": time.time()}
        self.jobs[jid] = job
        self.done[jid] = event
        logger = self.logger
        logger.info("job %s %s started", kind, jid)

        def log(line: str) -> None:
            job["log"].append(str(line))
            logger.info("[%s %s] %s", kind, jid[:6], line)

        def run():
            try:
                job["result"] = fn(log)
                job["state"] = "done"
                logger.info("job %s %s done in %.0fs", kind, jid, time.time() - job["t"])
            except BaseException as e:  # a job must end, whatever went wrong
                if getattr(e, "details", None):  # what the tool said, in full
                    job["trace"] = str(e.details)[-6000:]
                elif not isinstance(e, (NetworkError, RomError, ValueError)):
                    job["trace"] = traceback.format_exc()[-4000:]
                job["error"] = job_error(e, self.log_path)
                job["state"] = "error"  # last: whoever sees the state sees the rest
                logger.error("job %s %s failed: %s\n%s", kind, jid, job["error"], traceback.format_exc())
                if isinstance(e, (KeyboardInterrupt, SystemExit)):
                    raise
            finally:
                event.set()  # state is already final here, so a waiter always reads the real outcome
        threading.Thread(target=run, daemon=True, name=f"job-{kind}").start()
        return jid


class Settings:
    def __init__(self, path: Path):
        self.path = path
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {}
        if not isinstance(self.data.get("endpoints"), list):  # one saved "api" before 0.10.1: the first endpoint
            old = self.data.get("api") if isinstance(self.data.get("api"), dict) else {}
            self.data["endpoints"] = [agents.endpoint_entry(old | {"id": "e1"})] if old.get("base_url") or old.get("provider") else []

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        with contextlib.suppress(OSError):
            os.chmod(self.path, 0o600)

    # -- API endpoints: OpenAI-compatible servers for the built-in agent, each with its own address, model and key

    def endpoints(self) -> list[dict]:
        return [e for e in self.data.get("endpoints") or [] if isinstance(e, dict) and e.get("id")]

    def endpoint(self, eid: str) -> dict | None:
        return next((e for e in self.endpoints() if e["id"] == eid), None)

    def save_endpoint(self, data: dict) -> dict:
        """Add an endpoint (no id) or change one. A key is only replaced by a new one typed in (the masked one the
        GUI shows comes back unchanged)."""
        numbers = {}
        for k in ("context_tokens", "max_sessions"):  # the model's context in tokens (empty = find out); a box's limit
            if k in data:
                try:
                    numbers[k] = int(str(data[k] or "").strip() or 0)
                except ValueError:
                    raise ValueError("the context size is a number of tokens, like 16384" if k == "context_tokens"
                                     else "the session limit is a number, like 1") from None
        current = self.endpoint(str(data.get("id") or ""))
        if current is None:  # ids are never reused: a session resumed later can't end up on another machine
            ids = {e["id"] for e in self.endpoints()}
            n = max(int(self.data.get("endpoint_seq") or 0), len(ids)) + 1
            while f"e{n}" in ids:
                n += 1
            self.data["endpoint_seq"] = n
            current = {"id": f"e{n}"}
            self.data.setdefault("endpoints", []).append(current)
        for k in ("name", "provider", "base_url", "model"):
            if k in data:
                current[k] = str(data[k] or "").strip()
        for k, n in numbers.items():
            if n:
                current[k] = max(2048, n) if k == "context_tokens" else max(1, min(n, 32))
            else:
                current.pop(k, None)
        if data.get("api_key") and "•" not in str(data["api_key"]):
            current["api_key"] = str(data["api_key"]).strip()
        if data.get("clear_key"):
            current.pop("api_key", None)
        current.update(agents.endpoint_entry(current))
        return current

    def remove_endpoint(self, eid: str) -> None:
        self.data["endpoints"] = [e for e in self.endpoints() if e["id"] != eid]

    def public(self) -> dict:
        def masked(e: dict) -> dict:
            out = {k: v for k, v in e.items() if k != "api_key"}
            if e.get("api_key"):
                out["api_key"], out["has_key"] = "•" * 8 + e["api_key"][-4:], True
            return out

        eps = [masked(e) for e in self.endpoints()]
        return {"endpoints": eps, "api": eps[0] if eps else {},
                "per_session": self.data.get("per_session", agents.PER_SESSION), "last_project": self.data.get("last_project"),
                "autopilot": self.data.get("autopilot", True), "budget_usd": self.data.get("budget_usd") or 0,
                "auto_update": bool(self.data.get("auto_update")), "check_updates": self.data.get("check_updates", True) is not False,
                "launcher": _launcher(self.data.get("launcher") or {}), "recent_models": self.data.get("recent_models") or {}}


def _session_options(entry: dict) -> dict:
    """What a built-in agent session needs from its endpoint."""
    out = {"endpoint": entry.get("id") or "", "provider": entry["provider"], "base_url": entry["base_url"],
           "model": entry["model"], "provider_name": entry["name"]}
    return out | {k: entry[k] for k in ("api_key", "context_tokens") if entry.get(k)}


def _spread(settings: Settings, manager, picked: list[str], count: int, given: dict) -> list[tuple[dict, int]]:
    """(endpoint, sessions) for a start of `count` built-in agent sessions: spread over the endpoints picked, one
    at a time in turn, each up to its own limit of sessions at once (a small box serves one request at a time).
    A start without endpoints (an older GUI, or an address typed in) uses the first saved one, with what it
    changes; a saved key only ever goes to its own endpoint's address."""
    if not picked:
        first = settings.endpoints()[0] if settings.endpoints() else {}
        typed = {k: v for k, v in given.items() if k in ("provider", "base_url", "model", "context_tokens") and v}
        entry = agents.endpoint_entry(first | typed)
        if first and entry["base_url"].rstrip("/") != first["base_url"].rstrip("/"):
            entry.pop("api_key", None)
        if not entry.get("base_url") or not entry.get("model"):
            raise ValueError("add an API endpoint first (Agents & models): its address and model")
        return [(entry, count)]
    eps = [settings.endpoint(e) for e in picked]
    if any(e is None for e in eps):
        raise ValueError("an endpoint you picked isn't saved any more: pick again")
    busy = {e["id"]: sum(1 for x in manager.sessions.values() if x.kind == "api" and x.options.get("endpoint") == e["id"]
                         and x.state in ("starting", "working", "waiting") and not x.stop.is_set()) for e in eps}
    plan = {e["id"]: 0 for e in eps}
    for _ in range(count):
        room = [e for e in eps if not e.get("max_sessions") or busy[e["id"]] + plan[e["id"]] < int(e["max_sessions"])]
        if not room:
            break
        pick = min(room, key=lambda e: (busy[e["id"]] + plan[e["id"]], eps.index(e)))
        plan[pick["id"]] += 1
    if not any(plan.values()):
        raise ValueError("every endpoint you picked already runs as many sessions as you allowed it")
    return [(e, plan[e["id"]]) for e in eps if plan[e["id"]]]


def _launcher(saved: dict) -> dict:
    """The last launcher choice; one saved for Gemini CLI (retired) comes back as Antigravity with its default model."""
    if saved.get("kind") and agents.kind_id(saved["kind"]) != saved["kind"]:
        return {**saved, "kind": agents.kind_id(saved["kind"]), "model": ""}
    return saved


def _static(name: str) -> bytes | None:
    if ".." in name or name.startswith(("/", "\\")):
        return None
    try:
        return resources.files("decompnet.app").joinpath("static", name).read_bytes()
    except (FileNotFoundError, IsADirectoryError, OSError):
        return None


def build(net: RomNetwork, home: Path, port: int, secret: str):
    mcp_url = f"http://127.0.0.1:{port}/mcp"
    build_id = (updates.installed().get("commit") or "")[:12]  # a branch install: the commit it came from
    manager = agents.Manager(net, home, mcp_url)
    jobs = Jobs(home / "logs" / "decomp.log")
    settings = Settings(home / "settings.json")
    manager.budget = lambda: float(settings.data.get("budget_usd") or 0)
    rea.CONFIG = home / "rea.json"  # how REA starts: the RE console's settings, the agents' bridge reads them too
    console = Console()

    def remember(running: list[dict]) -> None:
        settings.data["running_agents"] = running
        settings.save()
    manager.persist = remember
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    def agent_of(ctx: Context):
        headers = ctx.headers or {}
        auth = headers.get("authorization") or headers.get("Authorization") or ""
        agent = net.authenticate(auth.removeprefix("Bearer ").strip() or None)
        slug = manager.project_of(agent.id) or settings.data.get("last_project")
        if not slug:
            raise NetworkError("no project is open in decomp.anything; open a ROM in the app first")
        return agent, slug

    threading.Thread(target=collab.local_addresses, daemon=True).start()  # `tailscale status` can take seconds
    # rooms this computer belongs to reconnect (members keep their place; their agents wait while the host is away)
    net.restore_links()

    # helpers that were working when the app last stopped carry on
    resume = [r for r in settings.data.get("running_agents", []) if isinstance(r, dict)]
    for r in resume:
        try:
            net.project_row(r["slug"])
            options = dict(r.get("options") or {})
            if r["kind"] == "api":
                saved = settings.endpoint(str(options.get("endpoint") or "")) if options.get("endpoint") else (
                    next((e for e in settings.endpoints() if e["base_url"] == options.get("base_url")), None))
                if saved is None and options.get("endpoint"):
                    continue  # its endpoint was removed since
                if saved is not None:  # as the endpoint is now, with its key
                    options.update(_session_options(saved))
            manager.start(r["kind"], r["slug"], 1, options)
        except (NetworkError, ValueError, KeyError):
            continue

    mcp = tools.build_mcp(net, agent_of)
    chat.register(mcp, net, manager, jobs, settings, port, secret)

    # Each agent sees the tools for its job: the agent you talk to sees everything; a helper only the work tools
    # for its project's kind (fewer tool definitions in every request, nothing it shouldn't call).
    from mcp_types import ListToolsResult, PaginatedRequestParams

    async def scoped_tools(ctx, params):
        everything = await mcp.list_tools()
        auth = (getattr(ctx.request, "headers", None) or {}).get("authorization", "")
        try:
            agent = net.authenticate(auth.removeprefix("Bearer ").strip() or None)
        except NetworkError:
            return ListToolsResult(tools=everything)
        if net.is_chat(agent):
            return ListToolsResult(tools=everything)
        slug = manager.project_of(agent.id) or settings.data.get("last_project")
        try:
            analysis = bool(slug and net.is_analysis(net.project_row(slug)))
        except NetworkError:
            analysis = False
        keep = set(tools.tool_names(bool(slug and net.fork_slug(slug)), analysis))
        return ListToolsResult(tools=[t for t in everything if t.name in keep])

    mcp._lowlevel_server.add_request_handler("tools/list", PaginatedRequestParams, scoped_tools)

    def guard(request: Request, write: bool = False) -> Response | None:
        if request.headers.get("host") not in allowed_hosts:
            return JSONResponse({"error": "bad host"}, status_code=403)
        if not secrets.compare_digest(request.cookies.get(COOKIE, ""), secret):
            return JSONResponse({"error": "open decomp.anything from the app or the `decomp` command"}, status_code=401)
        if write and request.headers.get("x-decomp") != "1":
            return JSONResponse({"error": "missing header"}, status_code=403)
        return None

    async def body(request: Request) -> dict:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except ValueError:
            return {}

    async def call(fn, *args):
        return await anyio.to_thread.run_sync(fn, *args)

    def fail(e: Exception, code: int = 400) -> JSONResponse:
        return JSONResponse({"error": str(e)}, status_code=code)

    # ------------------------------------------------------------------ pages

    @mcp.custom_route("/", methods=["GET"])
    async def index(request: Request) -> Response:
        if request.headers.get("host") not in allowed_hosts:
            return JSONResponse({"error": "bad host"}, status_code=403)
        key = request.query_params.get("k")
        if key:
            if not secrets.compare_digest(key, secret):
                return HTMLResponse("This link is from an earlier session. Open decomp.anything again.", status_code=401)
            resp = RedirectResponse("/", status_code=303)
            resp.set_cookie(COOKIE, secret, httponly=True, samesite="strict", max_age=30 * 86400)
            return resp
        if not secrets.compare_digest(request.cookies.get(COOKIE, ""), secret):
            return HTMLResponse("<!doctype html><meta charset=utf-8><title>decomp.anything</title>"
                                "<body style='font:16px system-ui;background:#0b0c0e;color:#e8e6e1;padding:3rem'>"
                                "Open decomp.anything from its app icon or by running <code>decomp</code>.", status_code=401)
        return HTMLResponse(_static("index.html").decode(), headers={"Cache-Control": "no-store"})

    @mcp.custom_route("/assets/{name:path}", methods=["GET"])
    async def asset(request: Request) -> Response:
        if request.headers.get("host") not in allowed_hosts:
            return Response(status_code=403)
        name = request.path_params["name"]
        data = _static(name)
        if data is None:
            return Response(status_code=404)
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        return Response(data, media_type=ctype, headers={"Cache-Control": "no-cache"})

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "app": "decomp-anything", "version": __version__, "build": build_id})

    # ------------------------------------------------------------------ state

    def overviews() -> list[tuple[str, dict | None, str]]:
        """(slug, overview or None, why not) for every project. One that can't be read is still listed, with the
        reason: before, one odd project emptied the whole sidebar, or quietly went missing from it."""
        out = []
        for p in net.store.all("SELECT slug, name FROM projects ORDER BY id DESC"):
            try:
                out.append((p["slug"], net.overview(p["slug"]), ""))
            except Exception as e:
                jobs.logger.warning("project %s can't be read: %s", p["slug"], e, exc_info=not isinstance(e, NetworkError))
                out.append((p["slug"], {"slug": p["slug"], "title": p["name"] or p["slug"]}, job_error(e, jobs.log_path)))
        return out

    def state() -> dict:
        projects = [ov | {"parent": (ov.get("source") or {}).get("parent"),
                          "entry": (ov.get("source") or {}).get("entry")} | ({"broken": why} if why else {})
                    for _, ov, why in overviews()]
        tcs = [t for t in toolchains.status() if t["id"] in COMPILERS or t["id"] in TOOLS]
        for t in tcs:
            t["use"] = COMPILERS.get(t["id"]) or TOOLS[t["id"]]
            t["name"] = SHORT_NAMES.get(t["id"], t["name"])
        return {"version": __version__, "build": build_id, "install": updates.installed(), **hostenv.info(),
                "platform": toolchains.current_platform(), "home": hostenv.shown_path(home.parent),
                "log_file": hostenv.shown_path(home / "logs" / "decomp.log"),
                "projects": projects, "toolchains": tcs, "agents": agents.detect(),
                "api_presets": agents.API_PRESETS, "settings": settings.public(), "mcp_url": mcp_url,
                "platform_status": PLATFORM_STATUS,
                "codewarrior": {"installed": toolchains.installed("mwcc") is not None,
                                "ds_installed": toolchains.installed("mwccarm") is not None, **MW_VERSIONS}}

    def autopilot(slug: str) -> None:
        """Free matches first, in the background, when the user wants that (the default): a game started from
        scratch, on any platform, as soon as it's ready. A public decomp, or one not set up yet, says no."""
        if settings.data.get("autopilot", True):
            with contextlib.suppress(NetworkError):
                net.start_autopilot(slug)

    def project_list() -> list[dict]:
        """The sidebar: every project with its progress and how many helper agents work on it right now."""
        running: dict[str, int] = {}
        for s in manager.sessions.values():
            if s.state in ("starting", "working", "waiting"):
                running[s.slug] = running.get(s.slug, 0) + 1
        out = []
        for slug, ov, why in overviews():
            out.append({k: ov.get(k) for k in ("slug", "title", "kind", "origin", "platform", "platform_name", "ready",
                                                "entries", "files", "functions", "matched", "bytes", "matched_bytes",
                                                "last_activity")}
                       | {"parent": (ov.get("source") or {}).get("parent"),
                          "entry": (ov.get("source") or {}).get("entry")}
                       | {"working": running.get(slug, 0), "room": (ov.get("room") or {}).get("role"),
                          "autopilot": (ov.get("autopilot") or {}).get("state")} | ({"broken": why} if why else {}))
        return out

    @mcp.custom_route("/api/projects", methods=["GET"])
    async def api_projects(request: Request) -> Response:
        return guard(request) or JSONResponse(await call(project_list))

    @mcp.custom_route("/api/state", methods=["GET"])
    async def api_state(request: Request) -> Response:
        return guard(request) or JSONResponse(await call(state))

    @mcp.custom_route("/api/companion", methods=["POST"])
    async def api_companion(request: Request) -> Response:
        """A PDB/MAP/symbol/trace/header that belongs with the binary being uploaded next."""
        if (bad := guard(request, write=True)):
            return bad
        q = request.query_params
        token = q.get("token", "")
        if not re.fullmatch(r"[a-f0-9]{8,32}", token):
            return fail(ValueError("bad companion token"))
        name = Path(q.get("name") or "").name
        if not name or name in (".", ".."):
            return fail(ValueError("name the companion file"))
        folder = home / "uploads" / token
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        size = 0
        async with await anyio.open_file(target, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_DISC:
                    await f.aclose()
                    target.unlink(missing_ok=True)
                    return fail(ValueError("that companion file is too large"))
                await f.write(chunk)
        if size == 0:
            target.unlink(missing_ok=True)
            return fail(ValueError("the companion file was empty"))
        return JSONResponse({"ok": True, "name": name, "size": size})

    @mcp.custom_route("/api/import", methods=["POST"])
    async def api_import(request: Request) -> Response:
        """A game the user owns: the demo, an upload streamed to disk (discs are gigabytes), or a local path."""
        if (bad := guard(request, write=True)):
            return bad
        q = request.query_params
        toolchain = q.get("toolchain") or None
        app_dir = False
        if q.get("demo") == "1":
            game: bytes | Path | None = _static("demo/demo-quest-64.z64")
            if game is None:
                return fail(ValueError("the demo ROM is missing from this install"))
            name = "demo-quest-64.z64"
        else:
            if q.get("confirmed") != "1":
                return fail(ValueError("confirm that this is your own legally obtained copy of the game"))
            if q.get("path"):
                game = hostenv.local_path(q["path"])
                app_dir = game.is_dir()
                if not game.is_file() and not app_dir:
                    return fail(ValueError(f"no file or folder at {game}"))
                name = game.name
            else:
                name = Path(q.get("name") or "game.bin").name
                companions = q.get("companions", "")
                if companions:
                    if not re.fullmatch(r"[a-f0-9]{8,32}", companions):
                        return fail(ValueError("bad companion token"))
                    upload_dir = home / "uploads" / companions
                    if not upload_dir.is_dir():
                        return fail(ValueError("the companion files are gone: drop the binary and its files together"))
                else:
                    upload_dir = home / "uploads" / uuid.uuid4().hex[:8]  # keeps the file's own name
                upload_dir.mkdir(parents=True, exist_ok=True)
                game = upload_dir / name
                size = 0
                async with await anyio.open_file(game, "wb") as f:
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > MAX_DISC:
                            await f.aclose()
                            game.unlink(missing_ok=True)
                            return fail(ValueError("that file is larger than any game disc"))
                        await f.write(chunk)
                if size == 0:
                    game.unlink(missing_ok=True)
                    return fail(ValueError("the file was empty"))
        uploaded = isinstance(game, Path) and not app_dir and game.parent.parent == home / "uploads"

        def work(log):
            try:
                if app_dir:
                    log("a folder: opening it as a JavaScript or Electron application with REA")
                    slug = net.import_analysis(game, tool="analyze_javascript_application", confirmed=True, log=log)
                else:
                    try:
                        slug = net.import_rom(game, toolchain=toolchain, confirmed=True, name=name, log=log)
                    except RomError as e:
                        if not isinstance(game, Path) or not _analyze_instead(e):
                            raise
                        log(f"{e}\nOpening it with REA instead: its functions become work items for the agents.")
                        slug = net.import_analysis(game, confirmed=True, copy_target=uploaded, log=log)
                auto = {}
                if isinstance(game, Path):
                    for p in sorted(game.parent.iterdir()):
                        lower = p.name.lower()
                        if lower in ("symbol_addrs.txt", "symbols.txt"):
                            auto.setdefault("symbols", str(p))
                        elif lower in ("coverage.csv", "trace.csv") or p.suffix.lower() in (".trace", ".cov"):
                            auto.setdefault("trace", str(p))
                        elif uploaded and lower in ("types.h", "context.h"):
                            auto.setdefault("types", str(p))
                intake = {key: q.get(key, "") or auto.get(key, "")
                          for key in ("notes", "symbols", "types", "refs", "trace", "libs")}
                if any(v.strip() for v in intake.values()):
                    report = net.apply_intake(slug, notes=intake["notes"], symbols=intake["symbols"],
                                              types=intake["types"], refs=intake["refs"], trace=intake["trace"],
                                              libraries=intake["libs"], log=log)
                    if report["warnings"]:
                        log("starting context warnings: " + "; ".join(report["warnings"]))
                try:
                    net.write_intake(slug, log=log)
                except Exception as e:  # noqa: BLE001
                    log(f"intake report skipped: {e}")
                settings.data["last_project"] = slug
                settings.save()
                if net.is_analysis(net.project_row(slug)):
                    # a native import with no procedure inventory opens on a survey item: decompile its starting
                    # batch now, in its own job, so the project page has code by the time the user gets there
                    jobs.start("prefill", lambda log: net.prefill_survey(slug, log=log))
                else:
                    autopilot(slug)
                return {"slug": slug}
            finally:
                if uploaded:
                    shutil.rmtree(game.parent, ignore_errors=True)
        return JSONResponse({"job": jobs.start("import", work)})

    MAP_KEYS = ("name", "vram", "size", "insns", "unit", "kind", "path", "child", "status", "best", "attempts",
                "hits", "agent", "matched_at", "matched_by")

    @mcp.custom_route("/api/map", methods=["GET"])
    async def api_map(request: Request) -> Response:
        """Every function, for the map and the table. `since`: the signature the GUI has; when nothing changed, the
        answer is just that (a big game's map is megabytes, and the GUI asks every few seconds). Rows go as arrays
        under `keys`, gzipped when the browser takes it."""
        if (bad := guard(request)):
            return bad
        slug = request.query_params.get("slug", "")

        def build() -> dict:
            sig = net.map_signature(slug)
            if request.query_params.get("since") == sig:
                return {"sig": sig, "same": True}
            rows = net.function_map(slug)
            return {"sig": sig, "keys": MAP_KEYS, "rows": [[r.get(k) for k in MAP_KEYS] for r in rows]}
        try:
            data = await call(build)
        except (NetworkError, ValueError) as e:
            return fail(e)
        raw = json.dumps(data, separators=(",", ":")).encode()
        if len(raw) > 4096 and "gzip" in request.headers.get("accept-encoding", ""):
            import gzip
            return Response(gzip.compress(raw, 1), media_type="application/json",
                            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
        return Response(raw, media_type="application/json")

    @mcp.custom_route("/api/log", methods=["GET"])
    async def api_log(request: Request) -> Response:
        """The end of decomp.anything's log, to read or attach to a bug report (the app's data folder isn't always at
        hand: in Docker it's inside the container)."""
        if (bad := guard(request)):
            return bad
        path = home / "logs" / "decomp.log"
        try:
            async with await anyio.open_file(path, "rb") as f:
                await f.seek(max(0, (await anyio.Path(path).stat()).st_size - (512 << 10)))
                text = (await f.read()).decode("utf-8", "replace")
        except OSError:
            text = "(nothing logged yet)"
        return Response(text, media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": 'inline; filename="decomp.log"'})

    @mcp.custom_route("/api/job", methods=["GET"])
    async def api_job(request: Request) -> Response:
        if (bad := guard(request)):
            return bad
        job = jobs.jobs.get(request.query_params.get("id", ""))
        return JSONResponse(job) if job else fail(ValueError("no such job"), 404)

    # ------------------------------------------------------------------ projects

    def with_project(fn):
        async def handler(request: Request) -> Response:
            if (bad := guard(request, write=request.method == "POST")):
                return bad
            data = await body(request) if request.method == "POST" else {}
            slug = data.get("slug") or request.query_params.get("slug", "")
            try:
                return JSONResponse(await call(lambda: fn(slug, request, data)))
            except (NetworkError, ValueError, toolchains.ToolchainError, OSError) as e:
                return fail(e)
        return handler

    def p_overview(slug, request, data):
        settings.data["last_project"] = slug
        settings.save()
        return net.overview(slug, backfill=True)

    def p_live(slug, request, data):
        q = request.query_params
        out = net.live(slug, int(q.get("e", 0) or 0), int(q.get("a", 0) or 0))
        try:
            since = json.loads(q.get("s") or "{}")
        except ValueError:
            since = {}
        out["sessions"] = [s for s in manager.snapshot(since) if s["slug"] == slug]
        return out

    def p_compiler(slug, request, data):
        net.set_compiler(slug, str(data.get("toolchain", "")), data.get("flags") or None)
        return net.overview(slug)

    def p_analyze_entry(slug, request, data):
        entry = str(data.get("entry") or "")
        if not entry:
            raise ValueError("name the archive entry to analyze")
        return {"job": jobs.start("analysis-entry", lambda log: net.analyze_archive_entry(slug, entry, log=log))}

    def p_contents_read(slug, request, data):
        entry = str(request.query_params.get("entry") or "")
        if not entry:
            raise ValueError("name the archive entry to read")
        return net.analysis_read_entry(slug, entry, int(request.query_params.get("offset") or 0),
                                       int(request.query_params.get("length") or 4096))

    def p_export(slug, request, data):
        def work(log):
            res = net.export_rom(slug, log=log)
            return {k: v for k, v in res.items() if k != "log"} | {"log": res.get("log", "")[-1500:]}
        return {"job": jobs.start("export", work)}

    def p_open(slug, request, data):
        why = hostenv.open_folder(Path(net.project_row(slug)["root"]))
        return {"ok": why is None, "message": why}

    def p_ide(slug, request, data):
        root = Path(net.project_row(slug)["root"])
        for command, label in (("code", "VS Code"), ("codium", "VSCodium"), ("clion", "CLion"),
                               ("idea", "IntelliJ IDEA"), ("rider", "Rider")):
            exe = shutil.which(command)
            if exe:
                subprocess.Popen([exe, str(root)], start_new_session=True)
                return {"ok": True, "editor": label}
        raise ValueError("no supported IDE command found (VS Code, VSCodium, CLion, IntelliJ IDEA or Rider)")

    def p_delete(slug, request, data):
        manager.stop()
        proj = net.project_row(slug)
        net.remove_project(slug)
        if data.get("files"):
            shutil.rmtree(proj["root"], ignore_errors=True)
        if settings.data.get("last_project") == slug:
            settings.data["last_project"] = None
            settings.save()
        return {"ok": True}

    def p_manual(slug, request, data):
        name = f"manual-{secrets.token_hex(2)}"
        agent, token = net.local_agent(name)
        manager.assignments[agent.id] = slug
        return {"agent": name, "url": mcp_url, "token": token,
                "claude": f'claude mcp add --transport http decomp {mcp_url} --header "Authorization: Bearer {token}"',
                "json": json.dumps({"mcpServers": {"decomp": {"type": "http", "url": mcp_url,
                                                              "headers": {"Authorization": f"Bearer {token}"}}}}, indent=2)}

    def p_try(slug, request, data):
        """You, editing a function in the GUI: judged like an agent's attempt (and credited to "you")."""
        agent, _ = net.local_agent("you")
        res = net.attempt(agent, str(data.get("name", "")), str(data.get("source", "")), slug)
        return {"score": res["score"], "matched": res["matched"], "text": res["text"][-4000:]}

    def p_release(slug, request, data):
        agent, _ = net.local_agent("you")
        with contextlib.suppress(NetworkError):  # not yours (any more): nothing to give back
            net.release(agent, str(data.get("name", "")), "", slug)
        return {"ok": True}

    def p_instructions(slug, request, data):
        net.set_instructions(slug, str(data.get("text", "")))
        return net.overview(slug)

    def p_priority(slug, request, data):
        return {"priority": net.set_priority(slug, str(data.get("name", "")), bool(data.get("on", True)))}

    def p_note(slug, request, data):
        """A note from you on a function (or the whole project): agents read notes when they claim it."""
        agent, _ = net.local_agent("you")
        text = str(data.get("text", "")).strip()
        if not text:
            raise ValueError("write the note first")
        return {"message": net.add_note(agent, slug, text[:2000], str(data.get("function", "")) or None)}

    def p_add_task(slug, request, data):
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("name the task first")
        return {"name": net.add_analysis_task(None, slug, name, str(data.get("brief", ""))[:4000])}

    def p_analysis_prefill(slug, request, data):
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValueError("name the work item first")

        def work(log):
            return {"prefill": net.analysis_prefill(slug, name, log=log)}
        return {"job": jobs.start("prefill", work)}

    def p_add_feature(slug, request, data):
        value = str(data.get("value", "")).strip()
        if not value:
            raise ValueError("give the feature a seed value")
        def work(log):
            return net.add_feature(slug, str(data.get("kind") or "string"), value,
                                   name=str(data.get("name") or ""), direction=str(data.get("direction") or "both"),
                                   match=str(data.get("match") or "") or None,
                                   case_sensitive=bool(data.get("case_sensitive")), log=log)
        return {"job": jobs.start("feature", work)}

    def p_feature(slug, request, data):
        return net.feature(slug, str(request.query_params.get("name") or ""))

    def p_remove_feature(slug, request, data):
        return net.remove_feature(slug, str(data.get("name") or ""))

    def p_source_file(slug, request, data):
        path = str(request.query_params.get("path") or "")
        if not path:
            raise ValueError("name the source file to read")
        return net.source_file(slug, path)

    def p_export_sources(slug, request, data):
        return {"job": jobs.start("sources", lambda log: net.export_sources(slug, log=log))}

    def p_debug_import(slug, request, data):
        path = str(data.get("path") or "").strip()

        def work(log):
            return net.import_debug_info(slug, path, log=log)
        return {"job": jobs.start("debug", work)}

    def p_debug_export(slug, request, data):
        return net.export_debug_info(slug)

    def p_compare(slug, request, data):
        path = str(data.get("path") or "").strip()

        def work(log):
            return net.compare_version(slug, path)
        return {"job": jobs.start("compare", work)}

    def p_trace(slug, request, data):
        path = str(data.get("path") or "").strip()

        def work(log):
            return net.import_trace(slug, path, log=log)
        return {"job": jobs.start("trace", work)}

    def p_autopilot(slug, request, data):
        if data.get("action") == "stop":
            net.stop_autopilot(slug)
        else:
            net.start_autopilot(slug)
        return net.overview(slug)

    routes = {
        "/api/project": (p_overview, ["GET"]),
        "/api/intake": (lambda s, r, d: net.write_intake(s, log=lambda *_: None), ["GET"]),
        "/api/summary": (lambda s, r, d: net.analysis_summary(s), ["GET"]),
        "/api/contents": (lambda s, r, d: net.analysis_contents(s), ["GET"]),
        "/api/contents/read": (p_contents_read, ["GET"]),
        "/api/analysis/entry": (p_analyze_entry, ["POST"]),
        "/api/live": (p_live, ["GET"]),
        "/api/function": (lambda s, r, d: net.function_detail(s, r.query_params.get("name", "")), ["GET"]),
        "/api/diff": (lambda s, r, d: net.function_diff(s, r.query_params.get("name", ""),
                                                        r.query_params.get("which", "latest")), ["GET"]),
        "/api/compiler": (p_compiler, ["POST"]), "/api/compiler/preview":
            (lambda s, r, d: net.preview_compiler(s, str(d.get("toolchain", "")), d.get("flags") or None), ["POST"]),
        "/api/project/recheck": (lambda s, r, d: net.recheck_project(s), ["POST"]),
        "/api/boundaries/repair": (lambda s, r, d: net.repair_boundaries(s), ["POST"]),
        "/api/export": (p_export, ["POST"]), "/api/open": (p_open, ["POST"]),
        "/api/ide": (p_ide, ["POST"]),
        "/api/delete": (p_delete, ["POST"]), "/api/agents/manual": (p_manual, ["POST"]),
        "/api/try": (p_try, ["POST"]), "/api/release": (p_release, ["POST"]),
        "/api/autopilot": (p_autopilot, ["POST"]), "/api/instructions": (p_instructions, ["POST"]),
        "/api/priority": (p_priority, ["POST"]), "/api/note": (p_note, ["POST"]),
        "/api/analysis/task": (p_add_task, ["POST"]),
        "/api/analysis/prefill": (p_analysis_prefill, ["POST"]),
        "/api/analysis/features": (lambda s, r, d: net.features(s), ["GET"]),
        "/api/analysis/feature": (p_feature, ["GET"]),
        "/api/analysis/feature/add": (p_add_feature, ["POST"]),
        "/api/analysis/feature/remove": (p_remove_feature, ["POST"]),
        "/api/sources": (lambda s, r, d: net.sources(s), ["GET"]),
        "/api/sources/file": (p_source_file, ["GET"]),
        "/api/sources/export": (p_export_sources, ["POST"]),
        "/api/debug/import": (p_debug_import, ["POST"]),
        "/api/debug/export": (p_debug_export, ["POST"]),
        "/api/compare": (p_compare, ["POST"]),
        "/api/trace/import": (p_trace, ["POST"]),
        "/api/stats": (lambda s, r, d: net.stats(s), ["GET"]),
        "/api/data": (lambda s, r, d: {"rows": net.data_symbols(
            s, r.query_params.get("q", ""), int(r.query_params.get("limit", 500) or 500))}, ["GET"]),
    }
    for path, (fn, methods) in routes.items():
        mcp.custom_route(path, methods=methods)(with_project(fn))

    # ------------------------------------------------------------------ forks of public decomps

    @mcp.custom_route("/api/catalog", methods=["GET"])
    async def api_catalog(request: Request) -> Response:
        """The public decomps decomp.dev listed, as this install downloaded them before it retired its directory."""
        if (bad := guard(request)):
            return bad
        projects, at = await call(net.forks.catalog)
        return JSONResponse({"projects": projects, "downloaded": at})

    @mcp.custom_route("/api/fork/policy", methods=["POST"])
    async def api_fork_policy(request: Request) -> Response:
        """What a public decomp says about AI and contributions, read from its own files before it's forked."""
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        try:
            return JSONResponse(await call(lambda: net.forks.policy(str(data.get("repo", "")))))
        except NetworkError as e:
            return fail(e)

    @mcp.custom_route("/api/fork", methods=["POST"])
    async def api_fork(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)

        def work(log):
            slug = net.forks.clone(str(data.get("repo", "")), name=str(data.get("name") or ""),
                                   platform=str(data.get("platform") or ""), version=data.get("version") or None, log=log)
            settings.data["last_project"] = slug
            settings.save()
            return {"slug": slug}
        return JSONResponse({"job": jobs.start("fork", work)})

    def fork_of(slug: str):
        if not net.fork_slug(slug):
            raise NetworkError(f"{slug} isn't a fork")
        return net.project_row(slug)

    @mcp.custom_route("/api/fork/game", methods=["POST"])
    async def api_fork_game(request: Request) -> Response:
        """The user's game file, streamed to disk (GameCube and Wii discs are gigabytes)."""
        if (bad := guard(request, write=True)):
            return bad
        q = request.query_params
        slug = q.get("slug", "")
        if q.get("confirmed") != "1":
            return fail(ValueError("confirm that this is your own legally obtained copy of the game"))
        try:
            proj = fork_of(slug)
        except NetworkError as e:
            return fail(e)
        tmp = Path(proj["root"]) / ".decomp-wtf" / f"upload-{uuid.uuid4().hex[:8]}.tmp"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        async with await anyio.open_file(tmp, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_DISC:
                    await f.aclose()
                    tmp.unlink(missing_ok=True)
                    return fail(ValueError("that file is larger than any game disc"))
                await f.write(chunk)
        name = Path(q.get("name") or "game.iso").name

        def work(log):
            try:
                res = net.forks.setup(slug, tmp, name, log=log, move=True)
            finally:
                tmp.unlink(missing_ok=True)
            autopilot(slug)
            return res
        return JSONResponse({"job": jobs.start("fork-setup", work)})

    @mcp.custom_route("/api/fork/setup", methods=["POST"])
    async def api_fork_setup(request: Request) -> Response:
        """Set up with a game file already on this computer (`path`), or with none (`path` empty: run the build)."""
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        slug = str(data.get("slug", ""))
        try:
            fork_of(slug)
        except NetworkError as e:
            return fail(e)
        path = str(data.get("path") or "").strip().strip('"')
        if path:
            if not data.get("confirmed"):
                return fail(ValueError("confirm that this is your own legally obtained copy of the game"))
            checked = await anyio.Path(path).expanduser()
            if not await checked.is_file():
                return fail(ValueError(f"no file at {checked}"))
            src = Path(str(checked))  # work() runs in a thread: it wants a plain pathlib.Path

        def work(log):
            res = net.forks.setup(slug, src, src.name, log=log) if path else net.forks.setup(slug, None, log=log)
            autopilot(slug)
            return res
        return JSONResponse({"job": jobs.start("fork-setup", work)})

    @mcp.custom_route("/api/fork/check", methods=["POST"])
    async def api_fork_check(request: Request) -> Response:
        """Pick a hand-built project up (or re-measure one): reads its objdiff.json and progress."""
        if (bad := guard(request, write=True)):
            return bad
        slug = str((await body(request)).get("slug", ""))
        try:
            fork_of(slug)
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"job": jobs.start("fork-check", lambda log: net.forks.check(slug, log=log))})

    @mcp.custom_route("/api/fork/rom-check", methods=["POST"])
    async def api_fork_rom_check(request: Request) -> Response:
        """A DS game from scratch: rebuild the ROM and compare it with the user's copy."""
        if (bad := guard(request, write=True)):
            return bad
        slug = str((await body(request)).get("slug", ""))
        try:
            fork_of(slug)
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"job": jobs.start("rom-check", lambda log: net.forks.check_rom(slug, log=log))})

    @mcp.custom_route("/api/fork/start-files", methods=["POST"])
    async def api_fork_start_files(request: Request) -> Response:
        """Give the code no source file covers source files (dtk-template projects), verified by the game's checksum."""
        if (bad := guard(request, write=True)):
            return bad
        slug = str((await body(request)).get("slug", ""))
        try:
            fork_of(slug)
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"job": jobs.start("fork-start-files", lambda log: net.forks.start_files(slug, log=log))})

    mcp.custom_route("/api/fork/needs", methods=["GET"])(with_project(lambda s, r, d: net.forks.needs(fork_of(s)["slug"])))

    # ------------------------------------------------------------------ installs, agents, settings

    @mcp.custom_route("/api/toolchain", methods=["POST"])
    async def api_toolchain(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        tid, accept = str(data.get("id", "")), bool(data.get("accept_license"))
        return JSONResponse({"job": jobs.start("toolchain", lambda log: (toolchains.install(tid, accept_license=accept, log=log)
                                                                         and {"id": tid}))})

    @mcp.custom_route("/api/agents/install", methods=["POST"])
    async def api_agent_install(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        kind = agents.KINDS.get(agents.kind_id(str((await body(request)).get("kind", ""))))
        if kind is None or not kind.install:
            return fail(ValueError("nothing to install"))
        cmd = kind.install["windows" if sys.platform == "win32" else "unix"]
        env = None
        if sys.platform == "win32":
            env = dict(os.environ, PATH=agents.search_path())  # Node.js installed since the app started counts
            if cmd.startswith("npm ") and not shutil.which("npm", path=env["PATH"]):
                return fail(ValueError(f"{kind.name} is installed with npm: install Node.js from https://nodejs.org "
                                       "first (the LTS version), then try again"))

        def work(log):
            log(f"$ {cmd}")
            if sys.platform == "win32":
                # Node.js's npm is a PowerShell script (npm.ps1) that Windows' default execution policy won't run;
                # output as UTF-8 so it reads right here; never wait at a prompt nobody sees
                argv = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                        f"[Console]::OutputEncoding = [Text.Encoding]::UTF8; {cmd}"]
            else:
                argv = ["bash", "-lc", cmd]
            proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                    errors="replace", env=env)
            try:
                for line in proc.stdout:
                    log(line.rstrip())
                if proc.wait() != 0:
                    raise RuntimeError(f"the installer exited with code {proc.returncode}")
            finally:
                if proc.stdout is not None:
                    proc.stdout.close()  # the pipe's file object, not left for the garbage collector
            agents._versions.pop(kind.id, None)
            return {"kind": kind.id}
        return JSONResponse({"job": jobs.start("agent-install", work)})

    @mcp.custom_route("/api/agents/start", methods=["POST"])
    async def api_agents_start(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        kind, slug = str(data.get("kind", "")), str(data.get("slug", ""))
        given = data.get("options") or {}
        options = {k: v for k, v in given.items() if k in ("model", "per_session")}
        options.setdefault("per_session", settings.data.get("per_session", agents.PER_SESSION))
        count = max(1, min(int(data.get("count", 1)), 8))
        picked: list[str] = []
        try:
            net.project_row(slug)
            if kind == "api":
                picked = [str(e) for e in (given.get("endpoints") or ([given["endpoint"]] if given.get("endpoint") else []))]
                plan = _spread(settings, manager, picked, count, given)
                ids = [sid for entry, n in plan for sid in manager.start(kind, slug, n, options | _session_options(entry))]
            else:
                ids = manager.start(kind, slug, count, options)
        except (NetworkError, ValueError) as e:
            return fail(e)
        # remembered, so the next start is one click; models typed in come back as suggestions
        model = str(options.get("model") or "")
        settings.data["launcher"] = {"kind": kind, "model": model, "count": count} | ({"endpoints": picked} if picked else {})
        if model and kind != "api":
            recent = settings.data.setdefault("recent_models", {}).setdefault(kind, [])
            settings.data["recent_models"][kind] = [model, *[m for m in recent if m != model][:7]]
        settings.save()
        return JSONResponse({"started": ids})

    @mcp.custom_route("/api/connect", methods=["GET", "POST"])
    async def api_connect(request: Request) -> Response:
        """Your agents (Claude Code, Codex, ...) with decomp.anything's tools: whether they have them, and adding them."""
        if (bad := guard(request, write=request.method == "POST")):
            return bad
        if request.method == "POST":
            kind = str((await body(request)).get("id", ""))
            try:
                msg = await anyio.to_thread.run_sync(lambda: connect.connect(kind))
            except (ValueError, OSError, subprocess.TimeoutExpired) as e:
                return fail(e)
            return JSONResponse({"ok": True, "message": msg})

        def rows():
            from concurrent.futures import ThreadPoolExecutor

            found = [a for a in agents.detect() if a["id"] in connect.LABEL]
            with ThreadPoolExecutor(len(found) or 1) as pool:  # each agent's own CLI answers; ask them all at once
                linked = list(pool.map(lambda a: a["installed"] and connect.status(a["id"]), found))
            return [{"id": a["id"], "name": a["name"], "installed": a["installed"], "connected": ok,
                     "command": connect.shown(a["id"])} for a, ok in zip(found, linked, strict=False)]
        if (host := hostenv.host_bridge()) is not None:  # the user's agents live outside decomp.anything's Linux
            return JSONResponse({"agents": [], "bridge": host, "host_bridge": host, **hostenv.info()})
        return JSONResponse({"agents": await anyio.to_thread.run_sync(rows), "bridge": connect.bridge_command()})

    @mcp.custom_route("/api/agents/token", methods=["POST"])
    async def api_agents_token(request: Request) -> Response:
        """An identity for an agent the user talks to, connecting through `decomp mcp`."""
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        try:
            agent, token = net.chat_agent(str(data.get("name") or "chat"))
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"agent": agent.name, "token": token, "url": mcp_url})

    @mcp.custom_route("/api/agents/stop", methods=["POST"])
    async def api_agents_stop(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        if data.get("remove"):
            manager.remove(str(data.get("id")))
        elif data.get("slug"):  # every helper on one project
            for s in list(manager.sessions.values()):
                if s.slug == data["slug"] and s.state in ("starting", "working", "waiting"):
                    manager.stop(s.id)
        else:
            manager.stop(data.get("id") or None)
        return JSONResponse({"ok": True})

    @mcp.custom_route("/api/settings", methods=["POST"])
    async def api_settings(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        if isinstance(data.get("api"), dict):  # (before 0.10.1: the one endpoint there was) the first one
            first = settings.endpoints()[0]["id"] if settings.endpoints() else ""
            settings.save_endpoint(data["api"] | {"id": first})
        if isinstance(data.get("endpoint"), dict):
            settings.save_endpoint(data["endpoint"])
        if data.get("remove_endpoint"):
            settings.remove_endpoint(str(data["remove_endpoint"]))
            for sid, sess in list(manager.sessions.items()):  # its sessions stop with it
                if sess.kind == "api" and sess.options.get("endpoint") == str(data["remove_endpoint"]):
                    manager.stop(sid)
        if "per_session" in data:
            settings.data["per_session"] = max(1, min(int(data["per_session"]), 20))
        if "autopilot" in data:
            settings.data["autopilot"] = bool(data["autopilot"])
        if "budget_usd" in data:
            settings.data["budget_usd"] = max(0.0, float(data["budget_usd"] or 0))
        if "auto_update" in data:
            settings.data["auto_update"] = bool(data["auto_update"])
        if "check_updates" in data:
            settings.data["check_updates"] = bool(data["check_updates"])
        settings.save()
        return JSONResponse(settings.public())

    # ------------------------------------------------------------------ RE console (console.py, REA)

    @mcp.custom_route("/api/rea", methods=["GET"])
    async def api_rea(request: Request) -> Response:
        return guard(request) or JSONResponse(await call(console.status))

    @mcp.custom_route("/api/rea/settings", methods=["POST"])
    async def api_rea_settings(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        env = data.get("env") if isinstance(data.get("env"), dict) else {}
        try:
            return JSONResponse(await call(console.configure, data.get("command") or "", env,
                                           str(data.get("provider") or "")))
        except ConsoleError as e:
            return fail(e)

    @mcp.custom_route("/api/rea/tools", methods=["GET"])
    async def api_rea_tools(request: Request) -> Response:
        if (bad := guard(request)):
            return bad
        try:
            return JSONResponse(await call(console.tools))
        except ConsoleError as e:
            return fail(e, 503)

    @mcp.custom_route("/api/rea/call", methods=["POST"])
    async def api_rea_call(request: Request) -> Response:
        """Any REA tool, as a job (opening a big program in Ghidra takes minutes). Tools that aren't read-only
        run only with `confirm`: the page asks the user first."""
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        tool, args = str(data.get("tool") or ""), data.get("arguments") or {}
        if not isinstance(args, dict):
            return fail(ValueError("arguments must be an object"))
        try:
            why = await call(console.needs_confirm, tool)
        except ConsoleError as e:
            return fail(e)
        if why and data.get("confirm") is not True:
            return JSONResponse({"error": f"{tool} {' and '.join(why)}: confirm to run it", "confirm": why},
                                status_code=409)
        for jid, job in list(jobs.jobs.items()):  # answers can be megabytes: keep only recent ones
            if job["kind"] == "rea" and job["state"] != "running" and time.time() - job["t"] > 600:
                jobs.jobs.pop(jid, None)
                jobs.done.pop(jid, None)
        return JSONResponse({"job": jobs.start("rea", lambda log: console.call(tool, args, log))})

    @mcp.custom_route("/api/rea/stop", methods=["POST"])
    async def api_rea_stop(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        await call(console.stop)
        return JSONResponse(await call(console.status))

    # ------------------------------------------------------------------ updates (updates.py)

    @mcp.custom_route("/api/update", methods=["GET", "POST"])
    async def api_update(request: Request) -> Response:
        """Whether a newer decomp.anything is out (checked now and then; ?refresh=1 now) and, POSTed, installing it."""
        if (bad := guard(request, write=request.method == "POST")):
            return bad
        if request.method == "POST":
            try:
                await call(updater.apply)
            except ValueError as e:
                return fail(e)
        refresh = request.query_params.get("refresh") == "1"
        if not refresh and not checking():  # the user turned checks off: only "Check now" asks
            return JSONResponse({"disabled": True, "available": False, "current": updates.installed(),
                                 "job": updater.job, "runtime": hostenv.runtime()})
        return JSONResponse(await call(lambda: updater.status(refresh)))

    def checking() -> bool:
        return settings.data.get("check_updates", True) is not False and os.environ.get("DECOMP_UPDATES") != "off"

    def watch_updates() -> None:
        """Check now and then; with "install updates automatically" on, install one while no helper is working."""
        time.sleep(20)
        while True:
            if not checking():
                time.sleep(300)
                continue
            try:
                st = updater.status()
                busy = any(s.state in ("starting", "working") for s in manager.sessions.values())
                if st.get("available") and st.get("can_apply") and settings.data.get("auto_update") and not busy:
                    updater.apply()
            except (ValueError, OSError):
                pass
            time.sleep(300)

    @mcp.custom_route("/api/quit", methods=["POST"])
    async def api_quit(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad

        def bye():
            manager.stop()
            manager.on_stop()
            time.sleep(0.5)
            os._exit(0)
        threading.Thread(target=bye, daemon=True).start()
        return JSONResponse({"ok": True})

    # ------------------------------------------------------------------ rooms (collab.py)
    # The tunnel only ever reaches this separate little server, never the GUI or the MCP endpoint above.

    share = {"servers": {}, "tunnel": None, "links": {}}

    def collab_server(public_port: int | None = None) -> int:
        """The room server: on 127.0.0.1 behind a quick tunnel, or on every network interface at `public_port` for
        a room shared at an address the host controls (LAN, Tailscale, a server). Only the room's API is served
        there, never the GUI or the agents' endpoint."""
        import socket

        import uvicorn

        key = ("0.0.0.0", public_port) if public_port else ("127.0.0.1", None)
        if key in share["servers"]:
            return share["servers"][key][1]
        host = key[0]
        if public_port:
            port = public_port
        else:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(collab.host_app(net, net.rooms), host=host, port=port, log_level="warning"))
        threading.Thread(target=server.run, daemon=True, name=f"collab-{port}").start()
        for _ in range(100):
            if server.started:
                break
            if getattr(server, "should_exit", False):
                break
            time.sleep(0.05)
        if not server.started:
            raise NetworkError(f"couldn't open port {port} for the room (is something else using it?)")
        share["servers"][key] = (server, port)
        return port

    def open_room(slug: str, mode: str, address: str = "", port: int = 0, log=print, keep: bool = False) -> str:
        room = net.rooms.get(slug) or collab.Room(net, slug)
        if mode == "address":
            address = address.strip().rstrip("/")
            if not re.match(r"^https?://[^/\s]+$", address):
                raise NetworkError("the address teammates use, like http://192.168.1.20:6481 or https://decomp.example.org")
            collab_server(port or 6481)
            code = room.open_invite(keep=keep, mode="address", address=address, port=port or 6481)
            base = address
        else:
            local = collab_server()
            code = room.open_invite(keep=keep, mode="tunnel")
            if share["tunnel"] is None or share["tunnel"].proc is None or share["tunnel"].proc.poll() is not None:
                log("opening a private tunnel to this computer (Cloudflare quick tunnel, no account needed)")
                share["tunnel"] = collab.Tunnel(local)
                share["tunnel"].start(log)
            base = share["tunnel"].url
        net.rooms[slug] = room
        link = f"{base}/join/{'open' if room.settings['visibility'] == 'public' else code}#room={slug}"
        share["links"][slug] = link
        return link

    # rooms shared at an address of the host's own come back when the app starts, with the same invite
    for p in net.store.all("SELECT slug, config FROM projects"):
        c = json.loads(p["config"]).get("collab") or {}
        if c.get("open") and c.get("mode") == "address" and c.get("address"):
            with contextlib.suppress(NetworkError, OSError):
                open_room(p["slug"], "address", c["address"], int(c.get("port") or 6481), keep=True)

    @mcp.custom_route("/api/collab", methods=["GET"])
    async def api_collab(request: Request) -> Response:
        if (bad := guard(request)):
            return bad
        slug = request.query_params.get("slug", "")
        try:
            info = await call(net._room_info, slug)
        except NetworkError as e:
            return fail(e)
        room = net.rooms.get(slug)
        cfg = (json.loads(net.project_row(slug)["config"]).get("collab") or {}) if slug else {}
        return JSONResponse({"sharing": room is not None, "link": share["links"].get(slug), "room": info,
                             "settings": room.settings if room else {"visibility": cfg.get("visibility", "private"),
                                                                       "approve": bool(cfg.get("approve"))},
                             "pending": room.pending() if room else [],
                             "mode": cfg.get("mode", "tunnel"), "address": cfg.get("address", ""), "port": cfg.get("port", 6481),
                             "was_sharing": bool(cfg.get("open")) and room is None,
                             "addresses": await anyio.to_thread.run_sync(collab.local_addresses),
                             "tunnel_supported": collab.cloudflared_available()})

    @mcp.custom_route("/api/collab/start", methods=["POST"])
    async def api_collab_start(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        slug = str(data.get("slug", ""))
        if slug in net.links:
            return fail(ValueError("this project belongs to a friend's room; only its host can invite people"))
        if net.fork_slug(slug) and not json.loads(net.project_row(slug)["config"]).get("ready"):
            return fail(ValueError("set the project up first (its Overview): then friends can join it"))
        mode = "address" if data.get("mode") == "address" else "tunnel"

        def work(log):
            room = net.rooms.get(slug) or collab.Room(net, slug)
            room.configure(data.get("visibility"), data.get("approve"))
            return {"link": open_room(slug, mode, str(data.get("address", "")), int(data.get("port") or 6481), log=log,
                                      keep=bool(data.get("keep")))}
        return JSONResponse({"job": jobs.start("share", work)})

    @mcp.custom_route("/api/collab/manage", methods=["POST"])
    async def api_collab_manage(request: Request) -> Response:
        """The host's controls: who's in, public or private, a fresh invite link."""
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        slug, action, name = str(data.get("slug", "")), str(data.get("action", "")), str(data.get("name", ""))
        room = net.rooms.get(slug)
        if room is None:
            return fail(ValueError("this project isn't being shared"))
        try:
            if action == "remove":
                room.remove(name)
            elif action in ("approve", "decline"):
                room.approve(name, action == "approve")
            elif action == "settings":
                room.configure(data.get("visibility"), data.get("approve"))
                c = room.cfg.get("collab") or {}
                share["links"][slug] = open_room(slug, c.get("mode", "tunnel"), c.get("address", ""),
                                                 int(c.get("port") or 6481), keep=True)
            elif action == "rotate":
                c = room.cfg.get("collab") or {}
                share["links"][slug] = open_room(slug, c.get("mode", "tunnel"), c.get("address", ""),
                                                 int(c.get("port") or 6481), keep=False)
            else:
                return fail(ValueError("unknown action"))
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"ok": True, "link": share["links"].get(slug), "members": room.members(),
                             "pending": room.pending(), "settings": room.settings})

    @mcp.custom_route("/api/service", methods=["GET", "POST"])
    async def api_service(request: Request) -> Response:
        """Run decomp.anything as a service that starts with the computer (keeps a team's room open)."""
        from . import service

        if (bad := guard(request, write=request.method == "POST")):
            return bad
        if request.method == "POST":
            action = str((await body(request)).get("action", ""))
            try:
                msg = await anyio.to_thread.run_sync(service.install if action == "install" else service.remove)
            except (RuntimeError, OSError) as e:
                return fail(e)
            return JSONResponse({"message": msg, "installed": service.installed()})
        return JSONResponse({"installed": await anyio.to_thread.run_sync(service.installed)})

    @mcp.custom_route("/api/collab/stop", methods=["POST"])
    async def api_collab_stop(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        slug = str((await body(request)).get("slug", ""))
        room = net.rooms.pop(slug, None)
        if room is not None:
            room.close()
        share["links"].pop(slug, None)
        if not net.rooms and share["tunnel"] is not None:
            share["tunnel"].stop()
            share["tunnel"] = None
        return JSONResponse({"ok": True})

    @mcp.custom_route("/api/collab/join", methods=["POST"])
    async def api_collab_join(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        q = request.query_params
        if q.get("confirmed") != "1":
            return fail(ValueError("confirm that this is your own legally obtained copy of the game"))
        link, name = q.get("link", ""), q.get("name", "")
        game: Path | None = None
        if q.get("path"):  # a file on this computer (a disc is gigabytes: not through the browser)
            game = hostenv.local_path(q["path"])
            if not game.is_file():
                return fail(ValueError(f"no file at {game}"))
        else:  # the browser's upload, streamed to disk
            upload = home / "uploads" / uuid.uuid4().hex[:8]
            upload.mkdir(parents=True, exist_ok=True)
            game = upload / (Path(q.get("filename") or "game.bin").name or "game.bin")
            size = 0
            async with await anyio.open_file(game, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_DISC:
                        await f.aclose()
                        shutil.rmtree(upload, ignore_errors=True)
                        return fail(ValueError("that file is larger than any game disc"))
                    await f.write(chunk)
            if size == 0:
                shutil.rmtree(upload, ignore_errors=True)
                game = None
        uploaded = game is not None and game.parent.parent == home / "uploads"

        def work(log):
            try:
                slug = collab.join_room(net, link, name, game or b"", log=log)
            finally:
                if uploaded:
                    shutil.rmtree(game.parent, ignore_errors=True)
            settings.data["last_project"] = slug
            settings.save()
            return {"slug": slug}
        return JSONResponse({"job": jobs.start("join", work)})

    @mcp.custom_route("/api/collab/reconnect", methods=["POST"])
    async def api_collab_reconnect(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        data = await body(request)
        slug, link = str(data.get("slug", "")), str(data.get("link", ""))
        return JSONResponse({"job": jobs.start("reconnect", lambda log: {"slug": collab.reconnect(net, slug, link, log=log)})})

    @mcp.custom_route("/api/collab/leave", methods=["POST"])
    async def api_collab_leave(request: Request) -> Response:
        if (bad := guard(request, write=True)):
            return bad
        try:
            await call(net.unlink, str((await body(request)).get("slug", "")))
        except NetworkError as e:
            return fail(e)
        return JSONResponse({"ok": True})

    def shutdown_rooms() -> None:
        if share["tunnel"] is not None:
            share["tunnel"].stop()
        for link in list(net.links.values()):
            link.stop()

    manager.on_stop = shutdown_rooms

    def before_restart() -> None:  # what quitting does: helpers stop now and resume in the new version
        manager.stop()
        manager.on_stop()
    updater = updates.Updater(before_restart, port, secret)
    threading.Thread(target=watch_updates, daemon=True, name="updates").start()

    security = TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=sorted(allowed_hosts),
                                         allowed_origins=[f"http://{h}" for h in sorted(allowed_hosts)])
    return mcp, manager, security
