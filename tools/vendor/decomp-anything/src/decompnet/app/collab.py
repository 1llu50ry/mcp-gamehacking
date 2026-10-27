"""Private rooms: friends who each own the same game decompile it together.

The host's decomp.wtf is the hub. It serves a small, separate HTTP app (only /collab routes; never the GUI or the
agents' MCP endpoint) that a quick tunnel makes reachable. A friend joins with the invite link *and their own copy of
the game*: the ROM's SHA-1 must equal the host's, checked on both sides. No ROM bytes or assembly ever cross the
wire. Each side reads the code from its own copy; what travels is the work: claims (so nobody does the same function
twice), C attempts, matches, names, struct/prototype edits, notes. The host re-compiles every attempt it accepts
against its own ROM, so a match always means the same thing.

Host side: `host_app()`. Guest side: `Link`, which RomNetwork consults for every collaborative action.
Projects that are git source trees (GameCube, Wii, DS, forks of public decomps) work the same way, with the host's
tree as the room's truth: see forkroom.py.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import secrets
import shutil
import subprocess
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from .. import toolchains
from ..network import Agent, NetworkError, _hash_token
from ..rom.symbols import AUTO_NAME
from . import forkroom

NAME = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
MAX_BODY = 256 * 1024
TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
# How far back a later sync re-reads layout changes: a row written while the host was reading its state table may
# commit with a slightly older timestamp, and applying a name or a boundary twice costs nothing.
LAYOUT_OVERLAP = 2.0
SYNC_EVERY = 2.0      # seconds between syncs of a room that is keeping up
BACKOFF_MAX = 60.0    # a room that keeps failing is retried at most this often


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


# ---------------------------------------------------------------------------------------------- host

class Room:
    """Host-side state for one shared project."""

    def __init__(self, net, slug: str):
        self.net, self.slug = net, slug
        self.proj = net.project_row(slug)
        self.fork = bool(net.fork_slug(slug))  # a git source tree (forkroom.py)
        self._hits: dict[str, deque] = defaultdict(lambda: deque(maxlen=900))
        self._members: tuple[float, list] = (0.0, [])  # cached: every member polls, the list changes slowly

    @property
    def settings(self) -> dict:
        """visibility: private (an invite link is needed) or public (the room's address is enough); approve: the
        host lets each new member in."""
        c = self.cfg.get("collab") or {}
        return {"visibility": c.get("visibility", "private"), "approve": bool(c.get("approve", False))}

    def configure(self, visibility: str | None = None, approve: bool | None = None) -> dict:
        cfg = self.cfg
        c = cfg.setdefault("collab", {})
        if visibility is not None:
            if visibility not in ("private", "public"):
                raise NetworkError("visibility is private or public")
            c["visibility"] = visibility
        if approve is not None:
            c["approve"] = bool(approve)
        with self.net.store.tx() as db:
            db.execute("UPDATE projects SET config=? WHERE slug=?", (json.dumps(cfg), self.slug))
        return self.settings

    def pending(self) -> list[dict]:
        return [dict(r) for r in self.net.store.all(
            "SELECT name, created_at FROM agents WHERE origin=? AND owner IS NULL ORDER BY created_at", self.origin + ":pending")]

    def approve(self, name: str, ok: bool = True) -> None:
        with self.net.store.tx() as db:
            row = db.execute("SELECT id FROM agents WHERE name=? AND origin=?", (name, self.origin + ":pending")).fetchone()
            if row is None:
                raise NetworkError(f"nobody called {name} is waiting")
            if ok:
                db.execute("UPDATE agents SET origin=? WHERE id=?", (self.origin, row["id"]))
                self.net._event(db, self.proj["id"], None, "collab", f"{name} joined")
            else:
                db.execute("UPDATE agents SET origin=?, token_hash=? WHERE id=?",
                           (self.origin + ":declined", "declined:" + secrets.token_hex(16), row["id"]))
        self._members = (0.0, [])

    @property
    def cfg(self) -> dict:
        return json.loads(self.net.project_row(self.slug)["config"])

    def open_invite(self, keep: bool = False, **where) -> str:
        """Open the room and return its invite code: a new one, or with `keep` the current one (the room reopening
        after the app restarted, so links people already have keep working). `where`: how it's shared
        (mode="tunnel" or mode="address" with address and port), remembered for reopening."""
        cfg = self.cfg
        old = cfg.get("collab") or {}
        code = old.get("code") if keep and old.get("code") else secrets.token_urlsafe(16)
        cfg["collab"] = {**old, **where, "invite": _hash(code), "code": code, "open": True,
                         "since": old.get("since") or time.time()}
        with self.net.store.tx() as db:
            db.execute("UPDATE projects SET config=? WHERE slug=?", (json.dumps(cfg), self.slug))
        return code

    def remove(self, name: str) -> None:
        """Take a member out of the room: their token stops working and their claims are freed."""
        with self.net.store.tx() as db:
            row = db.execute("SELECT id FROM agents WHERE name=? AND origin=? AND owner IS NULL", (name, self.origin)).fetchone()
            if row is None:
                raise NetworkError(f"{name} isn't a member of this room")
            db.execute("UPDATE agents SET token_hash=? WHERE id=?", ("removed:" + secrets.token_hex(16), row["id"]))
            db.execute("DELETE FROM claims WHERE agent_id IN (SELECT id FROM agents WHERE owner=? AND origin=?)",
                       (name, self.origin))
            db.execute("UPDATE agents SET origin=? WHERE id=?", (self.origin + ":removed", row["id"]))
            self.net._event(db, self.proj["id"], None, "collab", f"{name} was removed from the room")
        self._members = (0.0, [])

    def close(self) -> None:
        cfg = self.cfg
        if "collab" in cfg:
            cfg["collab"]["open"] = False
            with self.net.store.tx() as db:
                db.execute("UPDATE projects SET config=? WHERE slug=?", (json.dumps(cfg), self.slug))

    def invite_ok(self, code: str) -> bool:
        c = self.cfg.get("collab") or {}
        if not c.get("open"):
            return False
        return c.get("visibility") == "public" or secrets.compare_digest(c.get("invite", ""), _hash(code or ""))

    @property
    def origin(self) -> str:
        return f"collab:{self.slug}"

    def members(self) -> list[dict]:
        at, cached = self._members
        if time.time() - at < 3:
            return cached
        out = self._members_now()
        self._members = (time.time(), out)
        return out

    def _members_now(self) -> list[dict]:
        rows = self.net.store.all("SELECT id, name, created_at, last_seen FROM agents WHERE origin=? AND owner IS NULL",
                                  self.origin)
        out = []
        for r in rows:
            agents = self.net.store.all("SELECT id, name FROM agents WHERE origin=? AND owner=?", self.origin, r["name"])
            ids = [a["id"] for a in agents] or [-1]
            matched = self.net.store.one(
                f"SELECT COUNT(*) AS n FROM functions WHERE matched_agent_id IN ({','.join('?' * len(ids))})", *ids)["n"]
            working = [c["name"] for c in self.net.store.all(
                f"SELECT f.name FROM claims c JOIN functions f ON f.id=c.function_id WHERE c.agent_id IN "
                f"({','.join('?' * len(ids))})", *ids)]
            out.append({"name": r["name"], "joined": r["created_at"], "last_seen": r["last_seen"],
                        "online": bool(r["last_seen"]) and time.time() - r["last_seen"] < 30,
                        "agents": [a["name"].split(".", 1)[1] for a in agents], "matched": matched, "working": working})
        return out

    def join(self, name: str, sha1: str) -> tuple[str, str]:
        """New member: (token, the name they got; a taken name gets a number)."""
        if not NAME.match(name or ""):
            raise NetworkError("pick a name of up to 24 letters, digits, - or _")
        cfg = self.cfg
        want = forkroom.project_identity(cfg)
        if want and sha1 != want:
            what = (f"{cfg['rom']['title']}, {cfg['rom']['game_code']}" if not self.fork
                    else f"{self.proj['name']}, {cfg.get('version') or 'the same version'}")
            raise NetworkError("that isn't the same game: everyone in a room needs their own copy of exactly this "
                               f"game ({what}, same version)")
        base, n = name, 2
        while self.net.store.one("SELECT 1 FROM agents WHERE lower(name)=lower(?)", name):
            name, n = f"{base}{n}", n + 1
        token = "dn_" + secrets.token_urlsafe(24)
        waiting = self.settings["approve"]
        with self.net.store.tx() as db:
            db.execute("INSERT INTO agents(name,owner,token_hash,created_at,trusted,origin) VALUES(?,?,?,?,1,?)",
                       (name, None, _hash_token(token), time.time(), self.origin + (":pending" if waiting else "")))
            if waiting:
                self.net._event(db, self.proj["id"], None, "collab", f"{name} asks to join")
            else:
                self.net._event(db, self.proj["id"], None, "collab", f"{name} joined")
        self._members = (0.0, [])
        return token, name

    def member(self, request: Request) -> Agent:
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        agent = self.net.authenticate(token or None)
        row = self.net.store.one("SELECT origin, owner FROM agents WHERE id=?", agent.id)
        if row["origin"] == self.origin + ":pending":
            raise NetworkError("waiting for the host to let you in")
        if row["origin"] != self.origin or row["owner"] is not None:
            raise NetworkError("not a member of this room")
        hits = self._hits[agent.name]
        now = time.time()
        hits.append(now)
        if len(hits) == hits.maxlen and now - hits[0] < 60:
            raise NetworkError("slow down")
        return agent

    def agent_for(self, member: Agent, label: str) -> Agent:
        """The host-side identity of one of a member's agents, e.g. alex.claude-1."""
        label = re.sub(r"[^A-Za-z0-9_-]", "", str(label or "agent"))[:24] or "agent"
        name = f"{member.name}.{label}"
        row = self.net.store.one("SELECT id FROM agents WHERE name=?", name)
        if row is None:
            with self.net.store.tx() as db:
                aid = db.execute("INSERT INTO agents(name,owner,token_hash,created_at,trusted,origin) VALUES(?,?,?,?,1,?)",
                                 (name, member.name, "remote:" + secrets.token_hex(16), time.time(), self.origin)).lastrowid
            return Agent(aid, name, member.name, True)
        return Agent(row["id"], name, member.name, True)

    def state(self, e: int, a: int, ctx_version: int, member: Agent, layout_at: float = 0.0) -> dict:
        """What changed since the guest's cursors: work product only, never ROM-derived data."""
        if self.fork:
            return self._fork_state(e, member)
        pid = self.proj["id"]
        net = self.net
        with net.store.tx() as db:
            net._expire_claims(db)
        events = net.store.all("SELECT e.id, e.kind, e.detail, e.created_at, a.name AS agent FROM events e LEFT JOIN agents a "
                               "ON a.id=e.agent_id WHERE e.project_id=? AND e.id>? ORDER BY e.id LIMIT 500", pid, e)
        max_e = events[-1]["id"] if events else e
        kinds = {ev["kind"] for ev in events}
        names = {ev["detail"] for ev in events if ev["kind"] == "match"}
        out: dict = {"e": max_e, "events": [dict(ev) for ev in events]}
        first = e == 0
        if first or names:
            rows = net.store.all("SELECT f.name, f.vram, f.matched_source, a.name AS agent FROM functions f LEFT JOIN agents a "
                                 "ON a.id=f.matched_agent_id WHERE f.project_id=? AND f.status='matched'", pid)
            out["matched"] = [dict(r) for r in rows if first or r["name"] in names]
        best = net.store.all("SELECT f.name, f.vram, f.best_score, f.best_source, MAX(t.id) AS last FROM attempts t "
                             "JOIN functions f ON f.id=t.function_id WHERE f.project_id=? AND t.id>? AND f.status='open' "
                             "AND f.best_source IS NOT NULL GROUP BY f.id", pid, a)
        out["best"] = [{"name": r["name"], "vram": r["vram"], "score": r["best_score"], "source": r["best_source"]} for r in best]
        last = net.store.one("SELECT MAX(t.id) AS m FROM attempts t JOIN functions f ON f.id=t.function_id WHERE f.project_id=?", pid)
        out["a"] = max(a, last["m"] or 0)
        # The split and its names: everything on a member's first sync, then only the rows that changed since it
        # last saw them. A rename used to re-send every function and symbol of the room for one new name (17 MB in
        # a 70,000-function room), which is what made a busy room feel like it was never synced.
        cutoff = time.time()
        if layout_at <= 0:
            out["symbols"] = [dict(r) for r in net.store.all(
                "SELECT name, address, size, kind FROM symbols WHERE project_id=?", pid) if not AUTO_NAME.match(r["name"])]
            out["functions"] = [dict(r) for r in net.store.all(
                "SELECT name, vram, size FROM functions WHERE project_id=? ORDER BY vram", pid)]
        else:
            since = layout_at - LAYOUT_OVERLAP
            changed_functions = net.store.all(
                "SELECT name, vram, size FROM functions WHERE project_id=? AND changed_at>? ORDER BY vram", pid, since)
            changed_symbols = net.store.all(
                "SELECT name, address, size, kind FROM symbols WHERE project_id=? AND changed_at>? ORDER BY name",
                pid, since)
            if changed_functions:
                out["functions"] = [dict(r) for r in changed_functions]
            if changed_symbols:
                out["symbols"] = [dict(r) for r in changed_symbols]
        out["l"] = cutoff
        ctx = net._context(pid)
        if ctx["version"] != ctx_version:
            out["context"] = {"version": ctx["version"], "header": ctx["header"]}
        if first or kinds & {"note"}:
            out["notes"] = [dict(r) for r in net.store.all(
                "SELECT n.id, n.text, n.created_at, f.vram, a.name AS agent FROM notes n LEFT JOIN functions f ON f.id=n.function_id "
                "LEFT JOIN agents a ON a.id=n.agent_id WHERE n.project_id=? ORDER BY n.id", pid)]
        out["claims"] = [dict(r) for r in net.store.all(
            "SELECT f.name, f.vram, a.name AS agent FROM claims c JOIN functions f ON f.id=c.function_id JOIN agents a "
            "ON a.id=c.agent_id WHERE f.project_id=?", pid)]
        out["members"] = self.members()
        return out

    def _fork_state(self, e: int, member: Agent) -> dict:
        """A git project's room: events, matches (by name), claims and notes; the tree itself travels as bundles
        (GET /collab/bundle) when `head` moves."""
        pid, net = self.proj["id"], self.net
        with net.store.tx() as db:
            net._expire_claims(db)
        events = net.store.all("SELECT e.id, e.kind, e.detail, e.created_at, a.name AS agent FROM events e LEFT JOIN agents a "
                               "ON a.id=e.agent_id WHERE e.project_id=? AND e.id>? ORDER BY e.id LIMIT 500", pid, e)
        out: dict = {"e": events[-1]["id"] if events else e, "events": [dict(ev) for ev in events]}
        names = {ev["detail"] for ev in events if ev["kind"] == "match"}
        if e == 0 or names:
            rows = net.store.all("SELECT f.name, a.name AS agent FROM functions f LEFT JOIN agents a ON a.id=f.matched_agent_id "
                                 "WHERE f.project_id=? AND f.status='matched'", pid)
            out["matched"] = [dict(r) for r in rows if e == 0 or r["name"] in names]
        if e == 0 or any(ev["kind"] == "note" for ev in events):
            out["notes"] = [dict(r) for r in net.store.all(
                "SELECT n.id, n.text, n.created_at, f.name AS function, a.name AS agent FROM notes n LEFT JOIN functions f "
                "ON f.id=n.function_id LEFT JOIN agents a ON a.id=n.agent_id WHERE n.project_id=? ORDER BY n.id", pid)]
        out["claims"] = [dict(r) for r in net.store.all(
            "SELECT f.name, f.vram, a.name AS agent FROM claims c JOIN functions f ON f.id=c.function_id JOIN agents a "
            "ON a.id=c.agent_id WHERE f.project_id=?", pid)]
        out["head"] = forkroom.head(Path(self.proj["root"]))
        out["branch"] = forkroom.branch(Path(self.proj["root"]))
        out["members"] = self.members()
        return out


def host_app(net, rooms: dict[str, Room]) -> Starlette:
    """The public side of a shared project, served through the tunnel."""

    def room_for(request: Request) -> Room:
        slug = request.query_params.get("room") or request.headers.get("x-room", "")
        if not slug and len(rooms) == 1:  # a public room's bare address
            slug = next(iter(rooms))
        room = rooms.get(slug)
        if room is None:
            raise NetworkError("this room is closed")
        return room

    async def body(request: Request) -> dict:
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            raise NetworkError("request too large")
        try:
            data = await request.json()
        except ValueError:
            raise NetworkError("invalid request") from None
        if not isinstance(data, dict):
            raise NetworkError("invalid request")
        return data

    def endpoint(fn, auth: bool = True):
        async def handler(request: Request):
            import anyio

            try:
                room = room_for(request)
                data = await body(request) if request.method == "POST" else dict(request.query_params)
                member = await anyio.to_thread.run_sync(room.member, request) if auth else None
                result = await anyio.to_thread.run_sync(lambda: fn(room, member, data))
                return JSONResponse(result)
            except NetworkError as e:
                return JSONResponse({"error": str(e)}, status_code=400)
        return handler

    def hello(room, member, q):
        if not room.invite_ok(q.get("invite", "")):
            raise NetworkError("this invite link is no longer valid")
        cfg = room.cfg
        ov = net.overview(room.slug)
        if room.fork:
            return {"room": room.slug, **forkroom.hello(net, room.slug), "functions": ov["functions"],
                    "matched": ov["matched"], "members": len(room.members()), **room.settings}
        return {"room": room.slug, "kind": "rom", "title": cfg["rom"]["title"], "game_code": cfg["rom"]["game_code"],
                "region": cfg["rom"]["region"], "sha1": cfg["rom"]["sha1"], "compiler": cfg["compiler"],
                "functions": ov["functions"], "matched": ov["matched"], "members": len(room.members()),
                **room.settings}

    def join(room, member, d):
        if not room.invite_ok(str(d.get("invite", ""))):
            raise NetworkError("this invite link is no longer valid")
        token, name = room.join(str(d.get("name", "")), str(d.get("sha1", "")))
        return {"token": token, "room": room.slug, "name": name, "waiting": room.settings["approve"]}

    def whoami(room, member, q):
        return {"name": member.name, "room": room.slug}

    def state(room, member, q):
        try:
            layout_at = float(q.get("l") or 0)
        except ValueError:
            layout_at = 0.0
        return room.state(int(q.get("e") or 0), int(q.get("a") or 0), int(q.get("v") or 0), member, layout_at)

    def claim(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        fn = net.claim_row(agent, room.slug, d.get("function") or None, str(d.get("strategy") or "easiest"))
        return {"function": fn["name"] if fn else None, "vram": fn["vram"] if fn else None}

    def attempt(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        res = net.attempt(agent, str(d.get("function", "")), str(d.get("source", "")), room.slug)
        return {"score": res["score"], "matched": res["matched"]}

    def best(room, member, d):
        """A member's attempt got better: kept as the function's best so far, as reported (no compile here: the host
        only spends its CPU on verifying matches)."""
        agent = room.agent_for(member, d.get("agent"))
        net.apply_reported_best(room.slug, str(d.get("function", "")), int(d.get("score", 0)), str(d.get("source", ""))[:65536], agent)
        return {"ok": True}

    def release(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.release(agent, str(d.get("function", "")), str(d.get("notes", "")), room.slug)}

    def context(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.edit_context(agent, room.slug, str(d.get("old", "")), str(d.get("new", "")),
                                         str(d.get("message", "")), d.get("function") or None)}

    def rename(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.rename_symbol(agent, room.slug, str(d.get("old", "")), str(d.get("new", "")),
                                          str(d.get("message", "")))}

    def split(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.split_function(agent, room.slug, str(d.get("function", "")), str(d.get("at", "")),
                                           str(d.get("new_name", "")))}

    def note(room, member, d):
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.add_note(agent, room.slug, str(d.get("text", "")), d.get("function") or None)}

    def edit(room, member, d):
        """A member's edit of a git project's file (a header, a new or shared source file): made and checked here."""
        if not room.fork:
            raise NetworkError("this room's project has no files to edit")
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.forks.edit_file(agent, room.slug, str(d.get("path", "")), str(d.get("old", "")),
                                            str(d.get("new", "")), str(d.get("message", "")))}

    def split_file(room, member, d):
        if not room.fork:
            raise NetworkError("this room's project has no files to split")
        agent = room.agent_for(member, d.get("agent"))
        return {"text": net.forks.split_file(agent, room.slug, str(d.get("path", "")), str(d.get("at", "")),
                                             str(d.get("new_name", "")), str(d.get("data", "")))}

    async def get_bundle(request: Request):
        """The host's commits a member doesn't have yet (a git bundle: tracked files only, never the game)."""
        import anyio

        try:
            room = room_for(request)
            await anyio.to_thread.run_sync(room.member, request)
            if not room.fork:
                raise NetworkError("this room's project isn't a git tree")
            data = await anyio.to_thread.run_sync(lambda: forkroom.bundle(Path(room.proj["root"]),
                                                                           request.query_params.get("have", "")))
        except NetworkError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return Response(data, media_type="application/octet-stream", status_code=200 if data else 204)

    def leave(room, member, d):
        with net.store.tx() as db:
            db.execute("DELETE FROM claims WHERE agent_id IN (SELECT id FROM agents WHERE owner=? AND origin=?)",
                       (member.name, room.origin))
        return {"ok": True}

    async def landing(request: Request):
        return HTMLResponse("<!doctype html><meta charset=utf-8><title>decomp.wtf room</title>"
                            "<body style='font:16px system-ui;max-width:36em;margin:4rem auto;padding:0 1rem'>"
                            "<h1>decomp.wtf room</h1><p>This is an invite to decompile a game together. Open "
                            "<b>decomp.wtf</b>, choose <b>Join a friend</b>, and paste this page's address. "
                            "You'll need your own copy of the game.</p><p>Don't have the app? "
                            "<a href='https://decomp.wtf'>decomp.wtf</a></p>")

    routes = [
        Route("/", landing), Route("/join/{code}", landing),
        Route("/collab/hello", endpoint(hello, auth=False)),
        Route("/collab/join", endpoint(join, auth=False), methods=["POST"]),
        Route("/collab/state", endpoint(state)),
        Route("/collab/whoami", endpoint(whoami)),
        Route("/collab/claim", endpoint(claim), methods=["POST"]),
        Route("/collab/attempt", endpoint(attempt), methods=["POST"]),
        Route("/collab/best", endpoint(best), methods=["POST"]),
        Route("/collab/release", endpoint(release), methods=["POST"]),
        Route("/collab/context", endpoint(context), methods=["POST"]),
        Route("/collab/rename", endpoint(rename), methods=["POST"]),
        Route("/collab/split", endpoint(split), methods=["POST"]),
        Route("/collab/note", endpoint(note), methods=["POST"]),
        Route("/collab/leave", endpoint(leave), methods=["POST"]),
        Route("/collab/edit", endpoint(edit), methods=["POST"]),
        Route("/collab/split_file", endpoint(split_file), methods=["POST"]),
        Route("/collab/bundle", get_bundle),
    ]
    return Starlette(routes=routes)


class Tunnel:
    """A Cloudflare quick tunnel (free, no account) to the collab server."""

    def __init__(self, port: int):
        self.port, self.proc, self.url = port, None, None

    def start(self, log=print, timeout: float = 45) -> str:
        if toolchains.installed("cloudflared") is None:
            toolchains.install("cloudflared", log=log)
        exe_dir = toolchains.path("cloudflared")
        exe = exe_dir / ("cloudflared.exe" if (exe_dir / "cloudflared.exe").exists() else "cloudflared")
        self.proc = subprocess.Popen([str(exe), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{self.port}"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                     errors="replace")
        found = threading.Event()

        def read():
            for line in self.proc.stderr:
                m = TUNNEL_URL.search(line)
                if m and not self.url:
                    self.url = m.group(0)
                    found.set()
        threading.Thread(target=read, daemon=True).start()
        if not found.wait(timeout):
            self.stop()
            raise RuntimeError("couldn't open a tunnel (is the internet reachable?)")
        log(f"tunnel open: {self.url}")
        return self.url

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.proc, self.url = None, None


# --------------------------------------------------------------------------------------------- guest

def parse_invite(link: str) -> tuple[str, str]:
    """(base url, invite code) from a link like https://abc.trycloudflare.com/join/CODE#room=slug"""
    link = link.strip().rstrip("/")
    if re.match(r"^https?://[^/\s]+$", link):  # a public room's bare address
        return link, "open"
    m = re.match(r"^(https?://[^/\s]+(?::\d+)?)/join/([A-Za-z0-9_-]{4,})(?:#room=([\w-]+))?$", link)
    if not m:
        raise NetworkError("that doesn't look like a decomp.wtf invite link")
    return m.group(1), m.group(2) + (f"#{m.group(3)}" if m.group(3) else "")


class Link:
    """The guest's connection to a host's room."""

    def __init__(self, net, slug: str, url: str, room: str, token: str, member: str, client: httpx.Client | None = None):
        self.net, self.slug, self.url, self.room, self.token, self.member = net, slug, url.rstrip("/"), room, token, member
        self.client = client or httpx.Client(timeout=httpx.Timeout(60, connect=15))
        cfg = json.loads(net.project_row(slug)["config"])
        info = cfg.get("link") if isinstance(cfg.get("link"), dict) else {}
        saved = info.get("cursor") if isinstance(info.get("cursor"), dict) else {}
        # where this member got to last time: restarting the app then syncs only what it missed, not the whole room
        self.cursor = {"e": int(saved.get("e") or 0), "a": int(saved.get("a") or 0),
                       "v": int(saved.get("v") or 0), "l": float(saved.get("l") or 0.0)}
        self.claims: list[dict] = []
        self.members: list[dict] = []
        self.error = ""
        self.last_ok = 0.0
        self.syncing = False  # a sync is being applied: the room answered, so it isn't offline
        self.sync_ms = 0
        self.failures = 0     # syncs in a row that failed (the page counts down to the next try)
        self.last_try = 0.0
        self.next_try = 0.0
        self.layout: dict | None = None  # what the last layout apply could and couldn't do here (see engine)
        self._saved_cursor = 0.0
        self._last_saved = dict(self.cursor)  # what the project has: an idle room writes nothing
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.fork = bool(net.fork_slug(slug))  # a git source tree: follows the host's commits (forkroom.py)
        self.head = info.get("head", "")

    # -- transport

    def _req(self, method: str, path: str, data: dict | None = None) -> dict:
        headers = {"authorization": f"Bearer {self.token}", "x-room": self.room}
        try:
            if method == "GET":
                r = self.client.get(f"{self.url}{path}", params={**(data or {}), "room": self.room}, headers=headers)
            else:
                r = self.client.post(f"{self.url}{path}?room={self.room}", json=data or {}, headers=headers)
        except httpx.HTTPError as e:
            self.error = f"can't reach the host ({type(e).__name__})"
            raise NetworkError(f"the room's host isn't reachable right now: {self.error}") from None
        out = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200:
            self.error = out.get("error") or f"host answered {r.status_code}"
            raise NetworkError(self.error)
        self.error, self.last_ok = "", time.time()
        return out

    def _raw(self, path: str, params: dict) -> bytes:
        headers = {"authorization": f"Bearer {self.token}", "x-room": self.room}
        try:
            r = self.client.get(f"{self.url}{path}", params={**params, "room": self.room}, headers=headers,
                                timeout=httpx.Timeout(600, connect=15))
        except httpx.HTTPError as e:
            self.error = f"can't reach the host ({type(e).__name__})"
            raise NetworkError(f"the room's host isn't reachable right now: {self.error}") from None
        if r.status_code == 204:
            return b""
        if r.status_code != 200:
            raise NetworkError((r.json() if r.headers.get("content-type", "").startswith("application/json")
                                else {}).get("error") or f"host answered {r.status_code}")
        self.error, self.last_ok = "", time.time()
        return r.content

    # -- actions, called by RomNetwork for a linked project

    def claim(self, agent: Agent, function: str | None, strategy: str) -> str | None:
        return self._req("POST", "/collab/claim", {"agent": agent.name, "function": function, "strategy": strategy})["function"]

    def attempt(self, agent: Agent, function: str, source: str) -> dict:
        return self._req("POST", "/collab/attempt", {"agent": agent.name, "function": function, "source": source})

    def call(self, route: str, agent: Agent, /, **data) -> str:
        return self._req("POST", route, {"agent": agent.name, **data}).get("text", "")

    # -- mirroring the host's work into the local project

    def sync(self) -> None:
        with self._lock:
            self.syncing = True
            try:
                st = self._req("GET", "/collab/state", self.cursor)
                # the room answered: applying the work (a big room's first sync) is not a lost connection
                self.last_ok = time.time()
                self.apply(st)
                with contextlib.suppress(Exception):  # the work is applied; an unsaved cursor only costs a re-sync
                    self._save_cursor()
            finally:
                self.syncing = False

    def _save_cursor(self, force: bool = False) -> None:
        """Remember where this member got to (throttled: a sync every 2 s shouldn't write the project each time)."""
        now = time.time()
        if self.cursor == self._last_saved:
            return
        if not force and now - self._saved_cursor < 10:
            return
        self._saved_cursor = now

        def change(cfg):  # one transaction, so a rename or an export saving the config at the same time isn't lost
            info = cfg.get("link") if isinstance(cfg.get("link"), dict) else {}
            info["cursor"] = dict(self.cursor)
            cfg["link"] = info
        self.net._update_cfg(self.slug, change)
        self._last_saved = dict(self.cursor)

    def apply(self, st: dict) -> None:
        if self.fork:
            return self._apply_fork(st)
        net, slug = self.net, self.slug
        proj = net.project_row(slug)
        pid = proj["id"]
        mine = f"{self.member}."
        if st.get("symbols") is not None or st.get("functions") is not None:
            report = net.apply_remote_layout(slug, st.get("functions") or [], st.get("symbols") or [])
            self.layout = self._merge_layout(self.layout, report)
        if st.get("context"):
            net.apply_remote_context(slug, st["context"]["header"], st["context"]["version"])
            self.cursor["v"] = st["context"]["version"]
        for m in st.get("matched") or []:
            net.apply_remote_match(slug, m["vram"], m["matched_source"], m["agent"] or "host")
        for b in st.get("best") or []:
            net.apply_remote_best(slug, b["vram"], b["score"], b["source"])
        for n in st.get("notes") or []:
            net.apply_remote_note(slug, n["id"], n["vram"], n["text"], n["agent"] or "host", n["created_at"])
        for ev in st.get("events") or []:
            kinds = ("match", "claim", "release", "context", "rename", "split", "collab")
            if ev["kind"] in kinds and not (ev["agent"] or "").startswith(mine):
                net.remote_event(pid, ev["kind"], ev["detail"], ev["agent"] or "host", ev["created_at"])
        self.claims = [c for c in st.get("claims") or [] if not (c["agent"] or "").startswith(mine)]
        self.members = st.get("members") or []
        self.cursor["e"], self.cursor["a"] = st.get("e", self.cursor["e"]), st.get("a", self.cursor["a"])
        self.cursor["l"] = float(st.get("l") or self.cursor["l"])

    @staticmethod
    def _merge_layout(old: dict | None, new: dict) -> dict:
        """What to show in the page. A delta that applied nothing new doesn't prove an earlier gap is gone, so the
        earlier gaps stay until the room sends another split (the splits only ever move closer to each other)."""
        if old and not sum(new.get("skipped", {}).values()):
            return old
        return new

    def _apply_fork(self, st: dict) -> None:
        """A git project's room: follow the host's commits, then mirror matches, notes, events, claims."""
        net, slug = self.net, self.slug
        pid = net.project_row(slug)["id"]
        mine = f"{self.member}."
        if st.get("head") and st["head"] != self.head:
            self.pull(st.get("branch") or "")
        for m in st.get("matched") or []:
            net.apply_remote_match_named(slug, m["name"], m["agent"] or "host")
        for n in st.get("notes") or []:
            net.apply_remote_note_named(slug, n["function"], n["text"], n["agent"] or "host", n["created_at"])
        for ev in st.get("events") or []:
            if ev["kind"] in ("match", "claim", "release", "context", "split", "collab", "link") \
                    and not (ev["agent"] or "").startswith(mine):
                net.remote_event(pid, ev["kind"], ev["detail"], ev["agent"] or "host", ev["created_at"])
        self.claims = [c for c in st.get("claims") or [] if not (c["agent"] or "").startswith(mine)]
        self.members = st.get("members") or []
        self.cursor["e"] = st.get("e", self.cursor["e"])

    def pull(self, ref: str) -> bool:
        """Bring the host's new commits into this tree (while no agent here is building in it), rebuild what
        changed and measure again. Returns whether anything came."""
        forks = self.net.forks
        proj, fp, _ = forks.get(self.slug)
        data = self._raw("/collab/bundle", {"have": self.head})
        if data:
            with forks._tree(proj).exclusive():
                tip = forkroom.pull(fp.root, data, ref or forkroom.branch(fp.root))
                forks._build_all(proj, fp)
        else:
            tip = self._req("GET", "/collab/state", {"e": self.cursor["e"]}).get("head") or self.head
        self.head = tip
        forkroom.save_head(self.net, self.slug, tip)
        if data:
            forks.sync(self.slug, log=lambda *_: None)
        return bool(data)

    def run(self, every: float = SYNC_EVERY) -> None:
        def loop():
            while not self._stop.is_set():
                self._stop.wait(self._tick(every))
        threading.Thread(target=loop, daemon=True, name=f"link-{self.slug}").start()

    def _tick(self, every: float = SYNC_EVERY) -> float:
        """One sync attempt: record how long it took and how it went, and return the wait before the next one.

        A room that keeps failing is retried less and less often (up to a minute) instead of every two seconds, and
        the page counts down to the next try with the reason the last one failed."""
        started = time.time()
        try:
            self.sync()
            self.failures = 0
            wait = every
        except NetworkError as e:
            self.failures += 1
            self.error = self.error or str(e)
            wait = min(BACKOFF_MAX, every * 2 ** min(self.failures, 5))
        except Exception as e:  # noqa: BLE001 keep syncing; show the problem in the GUI
            self.failures += 1
            self.error = f"{type(e).__name__}: {e}"
            wait = min(BACKOFF_MAX, every * 2 ** min(self.failures, 5))
        self.sync_ms = int((time.time() - started) * 1000)
        self.last_try = time.time()
        self.next_try = self.last_try + wait
        return wait

    def stop(self) -> None:
        self._stop.set()
        with contextlib.suppress(Exception):  # a project that is already gone has nowhere to save to
            self._save_cursor(force=True)


def _hello(http: httpx.Client, link: str) -> tuple[str, str, dict]:
    url, code = parse_invite(link)
    code = code.split("#", 1)[0]
    room_hint = link.split("#room=", 1)[1] if "#room=" in link else ""
    try:
        r = http.get(f"{url}/collab/hello", params={"invite": code, "room": room_hint})
    except httpx.HTTPError:
        raise NetworkError("can't reach that room: is the host's decomp.wtf open and sharing?") from None
    hello = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200:
        raise NetworkError(hello.get("error", "the invite didn't work"))
    return url, code, hello


def _hosting(net, room: str, sha1: str | None) -> str | None:
    """The project on this computer that is a room host for the game being joined, if any: either the room in the
    link (same slug), or the same game's project shared as a host. Joining with it would make the host project a
    member of its own room, and the room would show as offline (and stop being hosted) from then on."""
    if room in net.rooms:
        return room
    if not sha1:
        return None
    for p in net.store.all("SELECT slug, config FROM projects"):
        cfg = json.loads(p["config"])
        if (cfg.get("collab") or {}).get("open") and forkroom.project_identity(cfg) == sha1:
            return p["slug"]
    return None


def _linked_project(net, sha1: str | None, room: str):
    for p in net.store.all("SELECT slug, config FROM projects"):
        cfg = json.loads(p["config"])
        if forkroom.project_identity(cfg) == sha1 and (cfg.get("link") or {}).get("room") == room:
            return p["slug"], cfg["link"]
    return None, None


def reconnect(net, slug: str, link: str, log=print, client: httpx.Client | None = None, start: bool = True) -> str:
    """Guest: the host restarted and shared a new link. Reconnect this project as the same member if the host still
    knows us, or join again with the invite."""
    http = client or httpx.Client(timeout=httpx.Timeout(60, connect=15))
    url, code, hello = _hello(http, link)
    proj = net.project_row(slug)
    cfg = json.loads(proj["config"])
    if (cfg.get("collab") or {}).get("open"):
        raise NetworkError(f"{slug} is set up to host a room: stop sharing it before joining another room, so the "
                           "two rooms don't mix.")
    if forkroom.project_identity(cfg) != hello.get("sha1"):
        raise NetworkError(f"that link is for {hello['title']}, a different game than this project")
    info = dict(cfg.get("link") or {})
    if info.get("token"):
        r = http.get(f"{url}/collab/whoami", params={"room": hello["room"]},
                     headers={"authorization": f"Bearer {info['token']}", "x-room": hello["room"]})
        if r.status_code == 200:
            old = net.links.pop(slug, None)
            if old is not None:
                old.stop()
            net.link_project(slug, info | {"url": url, "room": hello["room"], "member": r.json()["name"]},
                             client=client, start=start)
            log(f"reconnected to {hello['title']} as {r.json()['name']}")
            return slug
    name = info.get("member") or "friend"
    r = http.post(f"{url}/collab/join?room={hello['room']}", json={"invite": code, "name": name, "sha1": hello["sha1"]})
    joined = r.json()
    if r.status_code != 200:
        raise NetworkError(joined.get("error", "couldn't join"))
    old = net.links.pop(slug, None)
    if old is not None:
        old.stop()
    net.link_project(slug, {"url": url, "room": hello["room"], "token": joined["token"], "member": joined["name"],
                            "host_title": hello["title"], "head": info.get("head", "")}, client=client, start=start)
    log(f"joined {hello['title']} again as {joined['name']}")
    return slug


def join_room(net, link: str, name: str, rom: bytes | Path, log=print, client: httpx.Client | None = None,
              start: bool = True) -> str:
    """Guest: check the invite, check the ROM is the same game, join, import it locally, link. Returns the slug.
    If this game is already linked to that room here, reconnect instead (no ROM needed). `rom`: the game's bytes or
    the file (a GameCube or Wii disc is gigabytes: never read whole)."""
    from ..rom import detect

    http = client or httpx.Client(timeout=httpx.Timeout(60, connect=15))
    url, code, hello = _hello(http, link)
    hosted = _hosting(net, hello["room"], hello.get("sha1"))
    if hosted:
        raise NetworkError("this computer is hosting a room for this game: a host can't join a room for it from the "
                           "same project. Send the invite to a friend, test it from another computer, or stop sharing "
                           "this room before joining another.")
    slug, _info = _linked_project(net, hello["sha1"], hello["room"])
    if slug:
        return reconnect(net, slug, link, log=log, client=client, start=start)
    if not rom:
        raise NetworkError("pick your own copy of the game to join")
    if hello.get("kind") == "fork":
        return _join_fork(net, http, url, code, hello, name, rom, log, client, start)
    if isinstance(rom, Path):
        rom = rom.read_bytes()
    picked = detect.identify(rom)
    if picked.info["sha1"] != hello["sha1"]:
        raise NetworkError(f"this ROM isn't the same as the host's: the room is for {hello['title']} "
                           f"({hello['game_code']}, {hello['region']}), and every member needs their own copy of exactly that version")
    log(f"joining {hello['title']} ({hello['functions']} functions, {hello['matched']} matched)")
    r = http.post(f"{url}/collab/join?room={hello['room']}", json={"invite": code, "name": name, "sha1": hello["sha1"]})
    joined = r.json()
    if r.status_code != 200:
        raise NetworkError(joined.get("error", "couldn't join"))
    slug = net.import_rom(rom, toolchain=hello["compiler"]["toolchain"], flags=hello["compiler"]["flags"],
                          confirmed=True, log=log)
    net.link_project(slug, {"url": url, "room": hello["room"], "token": joined["token"], "member": joined["name"],
                            "host_title": hello["title"]}, client=client, start=start)
    log(f"linked as {joined['name']}: your agents now work with the room")
    return slug


def _join_fork(net, http: httpx.Client, url: str, code: str, hello: dict, name: str, game: bytes | Path, log,
               client: httpx.Client | None, start: bool) -> str:
    """Join a git project's room: the host's tree (forkroom.clone), the member's own copy of the game placed where
    the project wants it and built with the member's own tools, then linked."""
    import tempfile

    from ..forks.catalog import PLATFORMS

    tmp = None
    if not isinstance(game, Path):
        with tempfile.NamedTemporaryFile(prefix="decomp-join-", suffix=".game", delete=False) as fh:
            fh.write(game)  # closed here; delete=False keeps the bytes for the join, the cleanup unlinks it
        tmp = fh.name
        game = Path(tmp)
    try:
        if hello.get("sha1") and forkroom.game_identity(game) != hello["sha1"]:
            raise NetworkError(f"this isn't the same game as the host's: the room is for {hello['title']} "
                               f"({PLATFORMS.get(hello.get('platform'), hello.get('platform') or '')}, "
                               f"{hello.get('version') or 'the same version'}), and every member needs their own copy of "
                               "exactly that version")
        log(f"joining {hello['title']} ({hello['functions']} functions, {hello['matched']} matched)")
        r = http.post(f"{url}/collab/join?room={hello['room']}", json={"invite": code, "name": name, "sha1": hello.get("sha1") or ""})
        joined = r.json()
        if r.status_code != 200:
            raise NetworkError(joined.get("error", "couldn't join"))
        headers = {"authorization": f"Bearer {joined['token']}", "x-room": hello["room"]}

        def get_bundle(have: str) -> bytes:
            res = http.get(f"{url}/collab/bundle", params={"have": have, "room": hello["room"]}, headers=headers,
                           timeout=httpx.Timeout(600, connect=15))
            if res.status_code == 204:
                return b""
            if res.status_code != 200:
                raise NetworkError((res.json() if res.headers.get("content-type", "").startswith("application/json")
                                    else {}).get("error") or "the host couldn't send the project")
            return res.content

        slug = net.forks._free_slug(re.sub(r"[^a-z0-9]+", "-", hello["title"].lower()).strip("-")[:40] or "room")
        dest = net.workspace / slug
        try:
            forkroom.clone(dest, hello, get_bundle, log=log)
            forkroom.register_member(net, slug, dest, hello, hello["title"])
        except BaseException:
            shutil.rmtree(dest, ignore_errors=True)
            raise
        info = {"url": url, "room": hello["room"], "token": joined["token"], "member": joined["name"],
                "host_title": hello["title"], "head": forkroom.head(dest)}
        net.link_project(slug, info, client=client, start=False)  # its agents wait for the room from the start
        log("building the project with your copy of the game and your tools")
        net.forks.setup(slug, game, game.name if tmp is None else "", log=log, move=tmp is not None)
        if start:
            net.links[slug].run()
        log(f"linked as {joined['name']}: your agents now work with the room")
        return slug
    finally:
        if tmp is not None:
            Path(tmp).unlink(missing_ok=True)


def cloudflared_available() -> bool:
    return toolchains.get("cloudflared").supported or bool(shutil.which("cloudflared"))


_addresses: tuple[float, list[dict]] = (0.0, [])


def local_addresses() -> list[dict]:
    """Addresses teammates might reach this computer at: the LAN address, and Tailscale's when it's installed."""
    global _addresses
    if time.time() - _addresses[0] < 600:
        return _addresses[1]
    _addresses = (time.time(), _local_addresses())
    return _addresses[1]


def _local_addresses() -> list[dict]:
    import socket

    out = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))  # no packet is sent: this only picks the outgoing interface
            ip = sock.getsockname()[0]
        if not ip.startswith("127."):
            out.append({"label": "this network (LAN)", "address": f"http://{ip}:6481"})
    except OSError:
        pass
    ts = shutil.which("tailscale")
    if ts:
        try:
            res = subprocess.run([ts, "status", "--json"], capture_output=True, text=True, timeout=5,
                                 encoding="utf-8", errors="replace")
            me = json.loads(res.stdout).get("Self") or {}
            name = (me.get("DNSName") or "").rstrip(".")
            ips = [a for a in me.get("TailscaleIPs") or [] if "." in a]
            if name or ips:
                out.append({"label": "Tailscale (your tailnet)", "address": f"http://{name or ips[0]}:6481"})
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    return out
