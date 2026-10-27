"""`decomp mcp`: decomp.wtf for the agent you talk to.

Add it once to Claude Code, Codex, Antigravity CLI or opencode (`claude mcp add decomp -- decomp mcp`, ...). When that
agent uses it, this starts decomp.wtf in the background if it isn't running, gets the agent its own identity, and
passes the app's tools through over stdio: the agent can import your game, work on it, start helper agents and open
the live view, and everything it does shows up in the app as it happens.

Started by an agent decomp.wtf runs itself (a helper session whose agent only loads the MCP servers in the user's own
settings, like Antigravity CLI), it works as that session's agent instead (DECOMP_SESSION_TOKEN): the same identity,
tools and instructions the session would get connecting directly.

stdout is the MCP channel: everything else goes to stderr.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from .. import __version__
from .cli import _alive, home_dir, replace_older


def _log(msg: str) -> None:
    print(f"decomp mcp: {msg}", file=sys.stderr, flush=True)


def _session_lost(text: str) -> bool:
    """Whether a tool error means this MCP session is gone (app restarted, or the token was replaced)."""
    text = text.lower()
    return ("session terminated" in text or "connect" in text or "closed" in text
            or "invalid api token" in text or "missing api token" in text)


def _running(state: Path) -> dict | None:
    try:
        info = json.loads(state.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return info if info.get("port") and _alive(info["port"]) else None


def ensure_app(home: Path) -> dict:
    """The running app's {port, secret}, starting it in the background first if needed."""
    internal = home / ".decomp"
    state = internal / "server.json"
    if replace_older(state, log=_log) and (info := _running(state)):  # this version or newer; an older one restarts
        return info
    internal.mkdir(parents=True, exist_ok=True)
    _log("starting decomp.wtf in the background")
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} \
        if sys.platform == "win32" else {"start_new_session": True}
    with open(internal / "app.log", "ab") as out:
        subprocess.Popen([sys.executable, "-m", "decompnet.app.cli", "--no-browser"], stdin=subprocess.DEVNULL,
                         stdout=out, stderr=out, **kwargs)
    for _ in range(300):
        time.sleep(0.2)
        if (info := _running(state)):
            return info
    raise SystemExit(f"decomp mcp: decomp.wtf didn't start; see {internal / 'app.log'}")


def mint(info: dict, name: str) -> str:
    port = info["port"]
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/agents/token", method="POST",
                                 data=json.dumps({"name": name}).encode(),
                                 headers={"Cookie": f"decomp_live={info['secret']}", "X-Decomp": "1",
                                          "Host": f"127.0.0.1:{port}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    _log(f"connected as {data['agent']}")
    return data["token"]


async def proxy(info: dict, token: str, name: str, helper: bool = False) -> None:
    """Pass the app's tools through. When the app restarts (an update, or the user quit and started it again) the
    session is gone: connect again, with a new identity if it's a new app, and repeat the call. A helper session
    (`helper`) keeps its own identity: the app that started it is the one that knows it.

    One task owns the connection (anyio wants a client opened and closed by the same task); a call that finds the
    session lost asks it for a new one and waits."""
    import anyio
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    from mcp.server.lowlevel.server import Server
    from mcp.server.stdio import stdio_server

    from .chat import CHAT_INSTRUCTIONS

    conn: dict = {"info": info, "token": token, "remote": None, "gen": 0, "auth_lost": False}
    changed = asyncio.Condition()
    want_new = asyncio.Event()

    async def keep_connected() -> None:
        failures = 0
        while True:
            try:
                port = conn["info"]["port"]
                http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {conn['token']}"},
                                          timeout=httpx2.Timeout(900, connect=10))
                async with Client(streamable_http_client(f"http://127.0.0.1:{port}/mcp", http_client=http),
                                  read_timeout_seconds=900) as remote:
                    async with changed:
                        conn["remote"], conn["gen"] = remote, conn["gen"] + 1
                        changed.notify_all()
                    failures = 0
                    await want_new.wait()
                    want_new.clear()
            except Exception as e:  # a broken session can fail on the way out too
                if conn["gen"] == 0:
                    raise  # never connected: main says why
                failures += 1
                _log(f"connection to decomp.wtf lost ({e}); retrying")
                await anyio.sleep(min(10, failures))
            _log("decomp.wtf restarted: connecting again")
            try:
                fresh = await asyncio.to_thread(ensure_app, home_dir())
                if not helper and (conn["auth_lost"] or
                                   (fresh["port"], fresh["secret"]) != (conn["info"]["port"], conn["info"]["secret"])):
                    conn["token"] = await asyncio.to_thread(mint, fresh, name)  # a new app: a new identity
                    conn["auth_lost"] = False
                conn["info"] = fresh
            except (OSError, ValueError, KeyError, SystemExit) as e:
                _log(f"decomp.wtf isn't answering yet ({e})")
                await anyio.sleep(2)

    def lost(e: Exception) -> bool:
        return _session_lost(str(e)) or not _alive(conn["info"]["port"])

    async def remote_call(fn):
        for attempt in range(2):
            async with changed:
                await changed.wait_for(lambda: conn["remote"] is not None)
                remote, gen = conn["remote"], conn["gen"]
            try:
                return await fn(remote)
            except Exception as e:
                if attempt or not lost(e):
                    raise
                if "invalid api token" in str(e).lower() or "missing api token" in str(e).lower():
                    conn["auth_lost"] = True
                async with changed:
                    if conn["gen"] == gen:  # the first call to notice: ask for a new session
                        conn["remote"] = None
                        want_new.set()
                    await changed.wait_for(lambda g=gen: conn["gen"] > g)

    async with anyio.create_task_group() as tg:
        tg.start_soon(keep_connected)
        async with changed:
            await changed.wait_for(lambda: conn["remote"] is not None)

        async def list_tools(ctx, params):
            return await remote_call(lambda r: r.list_tools(cursor=params.cursor if params else None))

        async def call_tool(ctx, params):
            return await remote_call(lambda r: r.call_tool(params.name, params.arguments or {}))

        server = Server("decomp", version=__version__, title="decomp.wtf",
                        instructions=("" if helper else CHAT_INSTRUCTIONS + "\n") + (conn["remote"].instructions or ""),
                        on_list_tools=list_tools, on_call_tool=call_tool)
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())
        tg.cancel_scope.cancel()


def main(name: str = "chat") -> int:
    session = os.environ.get("DECOMP_SESSION_TOKEN", "").strip()  # a helper session decomp.wtf started
    try:
        info = ensure_app(home_dir())
        token = session or mint(info, name)
    except (OSError, ValueError, KeyError) as e:
        _log(f"couldn't connect to decomp.wtf: {e}. Try `decomp stop`, then use this again.")
        return 1
    if session:
        _log("connected as the helper session decomp.wtf started")
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(proxy(info, token, name, helper=bool(session)))
    return 0
