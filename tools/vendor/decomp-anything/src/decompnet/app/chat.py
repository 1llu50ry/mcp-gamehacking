"""Tools for the agent the user talks to: Claude Code, Codex, Antigravity CLI or opencode in the user's own terminal,
connected with `decomp mcp`. They let that agent do what the user would do in the app: list and open projects,
import the user's game, start helper agents, follow progress, export, and show the live view. Helper agents the app
starts itself only get the work tools (a helper can't start more helpers)."""

from __future__ import annotations

import contextlib

import anyio
from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError

from .. import hostenv
from ..network import NetworkError
from . import agents, tools

CHAT_INSTRUCTIONS = """\
You are connected to decomp.wtf on the user's computer: matching decompilation of games they own, with the game's
original compiler, a byte-for-byte judge, free matches from machine drafts, helper agents and a live view.

When the user wants a game decompiled:
1. list_projects(). If it's there, open_project(it). Otherwise import_game(path) with the path to the user's file
   (ROM, disc image or program). Ask the user to confirm it is their own legally obtained copy first, and never
   download games: decomp.wtf only works with the user's own copy.
2. open_gui() so the user can watch: the map lights up as functions match.
3. Work: claim_function -> compile_and_diff, repeat (guide("workflow") has the loop). For a big game, also
   start_agents(count) to add helper agents working in parallel; progress() shows everyone's work.
4. export_project() writes a decomp project that rebuilds the game byte for byte: the base for ports and mods.
Report progress in terms of functions and % of code matched. The game's code is the user's: never publish it.
"""


def register(mcp, net, manager, jobs, settings, port: int, secret: str) -> None:
    def chat_agent(ctx: Context):
        headers = ctx.headers or {}
        auth = headers.get("authorization") or headers.get("Authorization") or ""
        try:
            agent = net.authenticate(auth.removeprefix("Bearer ").strip() or None)
        except NetworkError as e:
            raise ToolError(str(e)) from None
        if not net.is_chat(agent):
            raise ToolError("this tool is for the agent the user talks to; helper agents only decompile functions")
        return agent

    def current(agent) -> str:
        slug = manager.project_of(agent.id) or settings.data.get("last_project")
        if not slug:
            raise ToolError("no project is open: list_projects() and open_project(), or import_game(path)")
        return slug

    def resolve(name: str) -> str:
        rows = net.store.all("SELECT slug, name FROM projects ORDER BY id DESC")
        q = name.strip().lower()
        for r in rows:
            if r["slug"] == q:
                return r["slug"]
        hits = [r["slug"] for r in rows if q and (q in r["slug"].lower() or q in (r["name"] or "").lower())]
        if len(hits) == 1:
            return hits[0]
        raise ToolError(f"no single project matches {name!r}; list_projects() shows them" if not hits else
                        f"{name!r} matches several projects: {', '.join(hits)}")

    def line(ov: dict) -> str:
        pct = 100 * ov["matched_bytes"] / (ov["bytes"] or 1)
        kind = "public decomp" if ov.get("kind") == "fork" and ov.get("origin") != "scratch" else "from scratch"
        return (f"- {ov['slug']}: {ov['title']} ({ov.get('platform_name') or ov.get('platform') or '?'}, {kind}) "
                f"{ov['matched']}/{ov['functions']} functions, {pct:.1f}% of code")

    def opened(agent, slug: str) -> None:
        manager.assignments[agent.id] = slug
        settings.data["last_project"] = slug
        settings.save()

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def list_projects(ctx: Context) -> str:
        """The games in decomp.wtf on this computer, with progress. Open one with open_project."""
        agent = chat_agent(ctx)
        rows = net.store.all("SELECT slug FROM projects ORDER BY id DESC")
        out = []
        for r in rows:
            try:
                out.append(line(net.overview(r["slug"])))
            except (NetworkError, OSError, KeyError):
                continue
        cur = manager.project_of(agent.id) or settings.data.get("last_project")
        if not out:
            return "No projects yet. import_game(path) starts one from the user's own copy of a game."
        return "\n".join(out) + (f"\nOpen now: {cur}" if cur else "\nNone is open: open_project(slug).")

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def open_project(ctx: Context, project: str) -> str:
        """Work on this project (slug or part of its title). The work tools then act on it."""
        agent = chat_agent(ctx)
        slug = resolve(project)
        opened(agent, slug)
        info = await anyio.to_thread.run_sync(lambda: tools.project_info(net, slug))
        return f"{info}\nShow the user the live view with open_gui()."

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def import_game(ctx: Context, path: str, own_copy: bool = False, compiler: str = "") -> str:
        """Start decompiling a game from scratch: the user's own ROM, disc image or program file on this computer
        (N64, PlayStation 1/2, GameCube, Wii, Game Boy Advance, DS). Finds every function and the compiler, then
        tries every function's machine draft in the background (free matches).

        Args:
            path: the game file on this computer
            own_copy: true only after the user confirmed it's their own legally obtained copy
            compiler: optional compiler id; leave empty to let decomp.wtf pick
        """
        agent = chat_agent(ctx)
        if not own_copy:
            raise ToolError("ask the user to confirm this is their own legally obtained copy of the game, then call "
                            "import_game again with own_copy=true")
        game = hostenv.local_path(path)
        if not game.is_file():
            hint = {"wsl": " (decomp.wtf runs in WSL: Windows drives are under /mnt, e.g. C:\\ is /mnt/c)",
                    "docker": " (decomp.wtf runs in Docker and sees your home folder only)"}.get(hostenv.runtime(), "")
            raise ToolError(f"no file at {game}{hint}")

        def work(log):
            slug = net.import_rom(game, toolchain=compiler or None, confirmed=True, name=game.name, log=log)
            if settings.data.get("autopilot", True):  # free matches first (a public decomp says no)
                with contextlib.suppress(NetworkError):
                    net.start_autopilot(slug)
            opened(agent, slug)
            return {"slug": slug}

        return await _follow(jobs.start("import", work))

    async def _follow(jid: str, wait: float = 55) -> str:
        job = jobs.jobs[jid]
        done = jobs.done[jid]
        if not done.is_set():  # the job's own thread sets it when it ends: no polling the dict
            await anyio.to_thread.run_sync(done.wait, wait)
        if job["state"] == "running":
            tail = job["log"][-1] if job["log"] else "working"
            return f"Still importing ({tail}). Call import_status(job=\"{jid}\") to keep waiting."
        if job["state"] == "error":
            raise ToolError(f"import failed: {job['error']}")
        slug = job["result"]["slug"]
        info = await anyio.to_thread.run_sync(lambda: tools.project_info(net, slug))
        ov = net.overview(slug)
        ap = " Autopilot is trying every function's machine draft in the background." if ov.get("autopilot") else ""
        return (f"Imported as {slug}.{ap}\n{info}\nNext: open_gui() so the user can watch, then claim_function(), "
                f"and start_agents() for helpers on a big game.")

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def import_status(ctx: Context, job: str) -> str:
        """Keep waiting for an import that was still running."""
        chat_agent(ctx)
        if job not in jobs.jobs:
            raise ToolError("no such import")
        return await _follow(job)

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def open_gui(ctx: Context) -> str:
        """Open decomp.wtf's live view of the current project in the user's browser: the function map, what every
        agent is doing, diffs, progress. Do this once when you start, so the user can watch."""
        agent = chat_agent(ctx)
        slug = manager.project_of(agent.id) or settings.data.get("last_project")
        url = f"http://127.0.0.1:{port}/?k={secret}" + (f"#/p/{slug}" if slug else "")
        ok = await anyio.to_thread.run_sync(lambda: hostenv.open_url(url))
        where = f"http://127.0.0.1:{port}/" + (f"#/p/{slug}" if slug else "")
        if ok:
            return f"Opened the live view in the user's browser ({where})."
        if hostenv.runtime() == "docker":  # the container can't reach the user's browser: hand them the link
            return f"Give the user this link to open the live view (it signs their browser in): {url}"
        return f"Couldn't open a browser here; the user can run `decomp` to open the app ({where})."

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def start_agents(ctx: Context, count: int = 1, kind: str = "", per_session: int = 0) -> str:
        """Start helper agents that decompile the current project in parallel with you (headless, shown live in
        the app). `kind`: claude, codex, antigravity or opencode (default: the first one installed)."""
        agent = chat_agent(ctx)
        slug = current(agent)
        if not kind:
            kind = next((a["id"] for a in agents.detect() if a["installed"] and a["id"] != "api"), "")
            if not kind:
                raise ToolError("no agent CLI is installed for helpers (Claude Code, Codex, Antigravity CLI or opencode)")
        options = {"per_session": per_session or settings.data.get("per_session", agents.PER_SESSION)}
        try:
            ids = manager.start(kind, slug, max(1, min(int(count), 8)), options)
        except ValueError as e:
            raise ToolError(str(e)) from None
        return (f"Started {', '.join(ids)} on {slug}. They claim functions you aren't working on; progress() and "
                f"the live view show their work. stop_agents() stops them.")

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def stop_agents(ctx: Context) -> str:
        """Stop the helper agents working on the current project."""
        agent = chat_agent(ctx)
        slug = current(agent)
        stopped = [s.id for s in list(manager.sessions.values()) if s.slug == slug and s.state in ("starting", "working", "waiting")]
        for sid in stopped:
            manager.stop(sid)
        return f"Stopped {', '.join(stopped)}." if stopped else "No helper agents were running on this project."

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def progress(ctx: Context) -> str:
        """Where the current project stands: matched code, who is working on what, autopilot, recent matches."""
        agent = chat_agent(ctx)
        slug = current(agent)

        def build() -> str:
            ov = net.overview(slug)
            live = net.live(slug)
            out = [line(ov).lstrip("- ")]
            ap = ov.get("autopilot")
            if ap:
                done = ap.get("done", ap.get("tried", 0))
                text = f"autopilot: {ap['state']}, {done}/{ap['total']} drafts done, {ap['matched']} matched"
                if ap.get("failed"):
                    text += f", {ap['failed']} didn't build" + (f" ({ap['reasons'][0]})" if ap.get("reasons") else "")
                out.append(text)
            working = [f"{c['agent']} on {c['name']}" for c in live["claims"] if c["agent"] != "autopilot"]
            out.append("working now: " + (", ".join(working) if working else "nobody"))
            helpers = [f"{s.id} ({s.state})" for s in manager.sessions.values() if s.slug == slug]
            if helpers:
                out.append("helper agents: " + ", ".join(helpers))
            matches = [e for e in live["events"] if e["kind"] == "match"][-8:]
            if matches:
                out.append("recent matches: " + ", ".join(f"{e['detail']} ({e['agent']})" for e in matches))
            return "\n".join(out)

        return await anyio.to_thread.run_sync(build)

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def run_autopilot(ctx: Context) -> str:
        """Try every open function's machine draft again (free matches). Worth it after types and names improved."""
        agent = chat_agent(ctx)
        slug = current(agent)
        try:
            st = net.start_autopilot(slug)
        except NetworkError as e:
            raise ToolError(str(e)) from None
        return f"Autopilot is trying {st['total']} functions' machine drafts in the background; progress() shows it."

    @mcp.tool(meta=tools.ALWAYS_LOAD)
    async def export_project(ctx: Context) -> str:
        """Write the project as a normal decomp source tree (matched C, the rest as assembly, a build script) and
        check that it rebuilds the game byte for byte. Returns where it is."""
        agent = chat_agent(ctx)
        slug = current(agent)
        try:
            res = await anyio.to_thread.run_sync(lambda: net.export_rom(slug, log=lambda *_: None))
        except (NetworkError, RuntimeError, OSError) as e:
            raise ToolError(str(e)) from None
        if res.get("identical") is None:
            return f"This project is already a source tree: {res['path']} (every match is committed to git)."
        verdict = "rebuilds the game byte for byte" if res["identical"] else "does NOT rebuild identically yet"
        return f"Exported to {res['path']}: {res.get('matched')} of {res.get('functions')} functions are C; it {verdict}."
