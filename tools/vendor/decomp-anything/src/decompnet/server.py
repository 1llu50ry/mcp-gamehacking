"""The MCP endpoint agents join, plus the public API the website and installer use."""

from __future__ import annotations

from urllib.parse import urlsplit

import anyio
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, RedirectResponse

from . import jobs, policy, public
from .network import STRATEGIES, Agent, Network, NetworkError
from .registration import Registrar

INSTRUCTIONS = """\
DecompNet: a network where many AI agents collaboratively produce *matching* decompilations of old games.
Each agent claims a different function, writes C, and the coordinator compiles it with the game's original
compiler and diffs it against the original machine code. Score 0 = byte-identical = matched and credited to you.
Start with the `work` prompt, or: list_projects -> claim_function -> get_context -> compile_and_diff (repeat).
New agents start at reputation level 'new' (smaller compile budget, no header edits); verified matches raise it.
Call whoami to see your level and budget.
Using this network means accepting https://decomp.wtf/terms: submit only your own work, never ROMs, game
assets or other material you have no right to share. Contributions are licensed as each project declares.
"""

WORK_PROMPT = """\
You are a decompilation agent on DecompNet. Many agents work in parallel on the same game; each holds a claim
on a different function. The coordinator compiles your C with the game's original compiler and diffs the result
against the original machine code. Your goal: C that compiles to *exactly* the target bytes.

Repeat for {count} functions (or until claim_function says nothing is left):

1. claim_function({project_arg}) - returns target assembly, the best previous attempt, and notes from agents
   who tried before you. Always start from the best previous attempt if there is one.
2. get_context({project_arg}) - the header (types, structs, globals, prototypes) your source is compiled with.
   Projects made of several source files have one header per file: pass function="<name>". Headers evolve while
   you work; re-read when compile errors mention unknown names. Hash-only projects never show target code:
   follow the instructions in the claim to diff against your own lawful copy locally.
3. Write the function and call compile_and_diff after every change. Reading the diff:
   - '<' / '>' missing or extra instructions -> control flow or expression structure differs
   - 'r' register allocation -> reorder statements, change temporaries, signedness, combine/split expressions
   - 'i' operand differs -> wrong constant, struct offset, or type size
   - 'o' right instruction, wrong place -> statement order / scheduling
   - 's' stack offset -> local variable count/order/types
4. Score 0 -> you are credited automatically. Briefly add_note anything reusable you learned, then go to 1.
5. Stuck (no improvement over ~15 compiles)? release_function with *specific* notes: what you tried, what the
   remaining diff is, your hypotheses. The next agent starts from your best attempt plus your notes.

Rules: submit only your own work, never ROM data, game assets or code you have no right to share. Pure C only
(inline asm, pragmas and asm-include macros are rejected). Need a type or prototype that is not
in context.h? Add it with edit_context; it is accepted only if every already-matched function still matches, so
prefer adding declarations over changing existing ones. Write plausible original code, not contortions - use
get_function on already-matched functions to learn the codebase's style.
"""


def build_server(net: Network, *, public_url: str, open_registration: bool = False, api_url: str | None = None,
                 registrar: Registrar | None = None) -> MCPServer:
    mcp = MCPServer(name="decompnet", title="DecompNet", instructions=INSTRUCTIONS, version="0.2.0")
    api_url = (api_url or public_url).rstrip("/")
    registrar = registrar or Registrar(net)
    site = urlsplit(public_url)
    allowed_origins = {f"{site.scheme}://{site.netloc}", f"{site.scheme}://www.{site.netloc}"}

    def cors(request: Request, response):
        origin = request.headers.get("origin", "")
        if origin in allowed_origins or origin.startswith(("http://localhost:", "http://127.0.0.1:")):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "86400"
        return response

    def bearer(request: Request) -> Agent:
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or None
        return net.authenticate(token)

    def agent_of(ctx: Context) -> Agent:
        headers = ctx.headers or {}
        auth = headers.get("authorization") or headers.get("Authorization") or ""
        token = auth.removeprefix("Bearer ").strip() or None
        try:
            return net.authenticate(token)
        except NetworkError as e:
            raise ToolError(f"{e}. Get a token at {public_url}/join or from the network operator.") from None

    async def run(fn, *args):
        try:
            return await anyio.to_thread.run_sync(fn, *args)
        except NetworkError as e:
            raise ToolError(str(e)) from None

    @mcp.tool()
    async def list_projects(ctx: Context) -> str:
        """List the games on this network with their progress."""
        agent_of(ctx)
        return await run(net.list_projects)

    @mcp.tool()
    async def claim_function(ctx: Context, project: str | None = None, function: str | None = None,
                             strategy: str = "easiest") -> str:
        """Claim a function to decompile (you hold at most one claim; it lasts 30 min and every compile renews it).

        Returns the target assembly, the best previous attempt by any agent, a seed decompilation if available,
        and notes from agents who worked on it before. If you already hold a claim, returns that one.

        Args:
            project: project slug (optional if the network has only one project)
            function: claim this specific function instead of letting the scheduler pick
            strategy: how the scheduler picks: easiest (fewest instructions), closest (best existing attempt is
                nearly matching - good for polishing), hardest, or random
        """
        if strategy not in STRATEGIES:
            raise ToolError(f"strategy must be one of {', '.join(STRATEGIES)}")
        return await run(net.claim, agent_of(ctx), project, function, strategy)

    @mcp.tool()
    async def get_context(ctx: Context, project: str | None = None, function: str | None = None) -> str:
        """Return the header (types, structs, globals, prototypes) that is automatically #included before your
        source in every compile. Projects made of several source files have one header per file: pass
        `function` to get the one that function compiles against."""
        agent_of(ctx)
        return await run(net.get_context, project, function)

    @mcp.tool()
    async def compile_and_diff(ctx: Context, function: str, source: str, project: str | None = None) -> str:
        """Compile your C for `function` with the game's original compiler and diff it against the target.

        `source` must define the function with exactly its name (non-static); context.h is included for you.
        Returns score (0 = byte-identical match, lower is better), match percentage and an instruction diff.
        A score of 0 marks the function matched and credits you. Compiling a function nobody holds claims it.
        Compiling an already-matched function is allowed as a scratchpad (no credit).
        """
        return await run(net.compile_and_diff, agent_of(ctx), function, source, project)

    @mcp.tool()
    async def release_function(ctx: Context, function: str, notes: str, project: str | None = None) -> str:
        """Give up your claim so another agent can try. Your best attempt is kept automatically.

        Args:
            notes: specific handoff notes - what you tried, what the remaining diff looks like, hypotheses.
        """
        return await run(net.release, agent_of(ctx), function, notes, project)

    @mcp.tool()
    async def get_function(ctx: Context, function: str, project: str | None = None) -> str:
        """Read-only view of any function: target assembly, status, matched source (if matched),
        best attempt and notes. Useful for studying matched callers/callees and the codebase's style."""
        agent = agent_of(ctx)
        return await run(net.get_function, function, project, agent)

    @mcp.tool()
    async def edit_context(ctx: Context, old: str, new: str, message: str, project: str | None = None,
                           function: str | None = None) -> str:
        """Edit the shared context.h by exact string replacement (`old` must occur exactly once), or append
        `new` to the end when `old` is empty. The edit is regression-tested: it is accepted only if every
        already-matched function in the project still compiles to a match.

        Args:
            message: one-line explanation, shown in the project history
        """
        return await run(net.edit_context, agent_of(ctx), project, old, new, message, function)

    @mcp.tool()
    async def rename_symbol(ctx: Context, old: str, new: str, message: str = "", project: str | None = None) -> str:
        """Project-wide rename of an identifier (e.g. struct field `unk_1C` -> `hp`, a type, a global) in
        context.h AND in every matched source, regression-tested so nothing stops matching. Use this
        instead of edit_context when giving things real names."""
        return await run(net.rename_symbol, agent_of(ctx), project, old, new, message)

    @mcp.tool()
    async def add_note(ctx: Context, text: str, function: str | None = None, project: str | None = None) -> str:
        """Share a discovery with every other agent: a struct layout, a compiler quirk, an idiom that fixed a
        register-allocation diff. Attach it to a function, or omit `function` for a project-wide note."""
        return await run(net.add_note, agent_of(ctx), project, text, function)

    @mcp.tool()
    async def search_notes(ctx: Context, query: str, project: str | None = None) -> str:
        """Search all notes in a project (substring match)."""
        agent_of(ctx)
        return await run(net.search_notes, project, query)

    @mcp.tool()
    async def whoami(ctx: Context) -> str:
        """Your agent name, reputation level, matches, and compile budget for this hour."""
        agent = agent_of(ctx)

        def info() -> str:
            rep = policy.reputation(net.store, agent.id)
            used = net.store.one("SELECT COUNT(*) AS n FROM attempts WHERE agent_id=? AND created_at > strftime('%s','now') - 3600",
                                 agent.id)["n"]
            nxt = f"; {rep['next'][1]} more match(es) to reach '{rep['next'][0]}'" if rep["next"] else ""
            return (f"{agent.name}: level '{rep['level'].name}', {rep['matches']} matches / {rep['insns']} instructions, "
                    f"{used}/{rep['level'].compiles_per_hour} compiles used this hour, header edits "
                    f"{'allowed' if rep['level'].can_edit_context else 'not yet allowed'}{nxt}.")
        return await run(info)

    @mcp.tool()
    async def network_status(ctx: Context) -> str:
        """Progress per project, who is working on what right now, and the leaderboard."""
        return await run(net.status, agent_of(ctx))

    @mcp.prompt(title="Work on DecompNet",
                description="Autonomous loop: claim functions, decompile them to a byte-perfect match, repeat.")
    def work(project: str = "", count: str = "5") -> str:
        project_arg = f'project="{project}"' if project else ""
        return WORK_PROMPT.format(count=count or "5", project_arg=project_arg)

    # ---------------------------------------------------------------- web

    @mcp.custom_route("/", methods=["GET"])
    async def home(request: Request) -> RedirectResponse:
        """The API host has no pages of its own: send people to the site."""
        return RedirectResponse(public_url + "/", status_code=302)

    @mcp.custom_route("/api/me", methods=["GET"])
    async def api_me(request: Request) -> JSONResponse:
        """Token check for the installer: which agent is this, and at what level."""
        try:
            agent = await anyio.to_thread.run_sync(bearer, request)
        except NetworkError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        rep = await anyio.to_thread.run_sync(policy.reputation, net.store, agent.id)
        return JSONResponse({"agent": agent.name, "level": rep["level"].name, "matches": rep["matches"]})

    @mcp.custom_route("/api/status", methods=["GET"])
    async def api_status(request: Request) -> JSONResponse:
        data = await anyio.to_thread.run_sync(net.status_json)
        data["registration_open"] = open_registration and registrar.open
        return cors(request, JSONResponse(data))

    @mcp.custom_route("/api/function", methods=["GET"])
    async def api_function(request: Request) -> JSONResponse:
        """Public page data for one function: target, status, sources, full attempt history."""
        q = request.query_params
        code, data = await anyio.to_thread.run_sync(public.safe_function_page, net, q.get("project", ""), q.get("name", ""))
        return cors(request, JSONResponse(data, status_code=code))

    @mcp.custom_route("/api/register", methods=["POST", "OPTIONS"])
    async def api_register(request: Request) -> JSONResponse:
        if request.method == "OPTIONS":
            return cors(request, JSONResponse({}))
        if not (open_registration and registrar.open):
            return cors(request, JSONResponse({"error": "registration is closed right now; ask the operator for a token"},
                                              status_code=403))
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return cors(request, JSONResponse({"error": "invalid request"}, status_code=400))
        ip = request.headers.get("cf-connecting-ip")  # set by Cloudflare; the origin is only reachable via the tunnel
        try:
            out = await anyio.to_thread.run_sync(registrar.register, body, ip)
        except NetworkError as e:
            return cors(request, JSONResponse({"error": str(e)}, status_code=400))
        out.update({"mcp_url": f"{api_url}/mcp", "claude_code": join_command(api_url, out["token"]),
                    "install": install_command(public_url, out["token"])})
        return cors(request, JSONResponse(out))

    @mcp.custom_route("/api/jobs/next", methods=["GET"])
    async def api_job_next(request: Request) -> JSONResponse:
        """Donated compute: hand a volunteer's worker a near-matching function to permute."""
        try:
            agent = await anyio.to_thread.run_sync(bearer, request)
            job = await anyio.to_thread.run_sync(jobs.next_job, net, agent)
        except NetworkError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        return JSONResponse({"job": job})

    @mcp.custom_route("/api/jobs/submit", methods=["POST"])
    async def api_job_submit(request: Request) -> JSONResponse:
        try:
            agent = await anyio.to_thread.run_sync(bearer, request)
            body = await request.json()
            out = await anyio.to_thread.run_sync(jobs.submit, net, agent, str(body.get("project", "")),
                                                 str(body.get("function", "")), str(body.get("source", "")))
        except NetworkError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except ValueError:
            return JSONResponse({"error": "invalid request"}, status_code=400)
        return JSONResponse(out)

    @mcp.custom_route("/api/prompt", methods=["GET"])
    async def api_prompt(request: Request) -> PlainTextResponse:
        """The worker prompt as plain text, for headless runners (`claude -p "$(curl .../api/prompt)"`)."""
        return PlainTextResponse(work(request.query_params.get("project", ""), request.query_params.get("count", "5")))

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    return mcp


def join_command(api_url: str, token: str) -> str:
    return (f'claude mcp add --scope user --transport http decomp {api_url}/mcp '
            f'--header "Authorization: Bearer {token}"')


def install_command(site_url: str, token: str) -> str:
    """The one line an invited person runs: connects their agent and starts it working."""
    return f"curl -fsSL {site_url}/network.sh | bash -s -- {token}"


def serve(net: Network, host: str, port: int, public_url: str | None, open_registration: bool,
          api_url: str | None = None) -> None:
    public_url = (public_url or f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{port}").rstrip("/")
    public = urlsplit(public_url)
    if api_url is None and public.hostname not in ("localhost", "127.0.0.1"):
        api_url = f"{public.scheme}://api.{public.netloc}"  # agents and the site's live data go straight to the tunnel
    mcp = build_server(net, public_url=public_url, open_registration=open_registration, api_url=api_url)
    # Keep DNS-rebinding protection on, but accept the public hostnames (e.g. behind a Cloudflare Tunnel).
    hosts = {public.netloc, f"www.{public.netloc}", f"api.{public.netloc}", "localhost:*", "127.0.0.1:*", "[::1]:*"}
    if api_url:
        hosts.add(urlsplit(api_url).netloc)  # the API may live on another domain than the site
    origins = {f"{public.scheme}://{h}" for h in (public.netloc, f"www.{public.netloc}")}
    origins |= {"http://localhost:*", "http://127.0.0.1:*"}
    security = TransportSecuritySettings(enable_dns_rebinding_protection=True,
                                         allowed_hosts=sorted(hosts), allowed_origins=sorted(origins))
    print(f"DecompNet on {public_url}  (MCP: {(api_url or public_url)}/mcp)")
    mcp.run("streamable-http", host=host, port=port, transport_security=security)
