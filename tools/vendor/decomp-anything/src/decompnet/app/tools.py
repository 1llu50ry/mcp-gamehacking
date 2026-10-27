"""The tools a decompiling agent gets, served over MCP to CLI agents and called directly by the
built-in API agent. Every tool works on the project the agent was started on."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from importlib import resources

import anyio
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from .. import __version__
from ..network import Agent, NetworkError
from . import references
from .engine import RomNetwork

GUIDES = {
    "workflow": "the matching loop, reading diffs, priorities",
    "mips": "MIPS registers, calling convention, delay slots, types from instructions",
    "gcc-kmc": "matching KMC GCC 2.7.2 code",
    "ido": "matching IDO 5.3/7.1 code",
    "m2c": "reading the machine-generated draft",
    "data": "globals, strings, tables, floats, data you define",
    "structs": "working out struct layouts from offsets",
    "n64": "N64 memory map, OS library, graphics/audio data",
    "naming": "naming functions and data",
    "fork": "working in a fork of a public decomp: the loop, conventions, what's allowed",
    "objdiff": "reading objdiff's diffs and match percentages",
    "ppc": "PowerPC (GameCube, Wii): registers, calling convention, common patterns",
    "mwcc": "matching Metrowerks CodeWarrior code (GameCube, Wii, DS)",
    "cpp": "decompiling C++: classes, vtables, constructors, inlines, name mangling",
    "psx": "matching PlayStation (PSY-Q GCC + maspsx) code",
    "ps2": "matching PlayStation 2 (EE-GCC, MWCC PS2) code",
    "arm": "ARM and Thumb (GBA, DS, 3DS): registers, conditional code, literal pools",
    "agbcc": "matching Game Boy Advance code built with agbcc",
    "x86": "x86 and x86-64 (PC, Xbox, Linux): calling conventions, SEH, matching MSVC, GCC and Clang output",
    "aarch64": "AArch64 and Clang (Switch): registers, matching Clang output",
    "similarity": "finding similar functions and reusing matched code",
    "analysis": "REA analysis projects: reading a target, recording findings, tasks",
}

# Guides worth reading first on each platform.
PLATFORM_GUIDES = {
    "n64": ["mips"], "ps": ["mips", "psx"], "ps2": ["mips", "ps2"], "psp": ["mips"],
    "gc": ["ppc", "mwcc", "cpp"], "wii": ["ppc", "mwcc", "cpp"], "nds": ["arm", "mwcc"], "3ds": ["arm", "cpp"],
    "gba": ["arm", "agbcc"], "switch": ["aarch64", "cpp"], "win32": ["x86", "cpp"], "xbox": ["x86", "cpp"],
    "xbox360": ["ppc", "cpp"], "windows": ["x86", "cpp"], "linux": ["x86", "cpp"],
}

INSTRUCTIONS = """\
decomp.anything: you are reverse-engineering a target the user owns. Matching projects turn functions into C or C++
that compiles to exactly the same machine code; analysis projects read any binary through REA and record what matters.
Start with project_info. `search_facts` finds functions, strings, APIs and addresses with their callers;
`list_subsystems` names the areas the imports and strings point at. Then claim_function. guide(topic) has know-how.
Everything runs on the user's computer.
The target is the user's: never publish it or its code anywhere.
"""

ANALYSIS_PROMPT = """\
You are a reverse-engineering agent in decomp.anything, working on {title}. This is an analysis project: the target
is read through REA, and your job is to understand it and leave precise findings for the next agent. There is no
compiler and no match score. Archive projects expose each regular file as a work item.

Repeat for up to {count} work items, then stop:
1. claim_function() gives you the next work item: a procedure, a file inside an archive, or a task. Procedure
   items include REA's dossier: pseudocode, assembly, callers and referenced strings/names. Archive entries show
   their path, hash and a bounded preview; read more with read_artifact_entry(entry, offset, length). If it is
   the survey item, you get the target overview, memory map and a batch of starting functions' pseudocode; a task
   whose brief names addresses gets those functions decompiled too.
2. Go deeper with rea_tool(tool, arguments): search_strings, search_procedures, analyze_function, xrefs,
   procedure_callers/callees, list_segments, read_bytes, inspect_native_api, inspect_artifact. Native targets also
   get batch_decompile, get_call_graph, trace_call_path, trace_feature, trace_native_values and search_bytes.
   search_facts searches the project's work items by name, string or address. Search first when you need context.
3. Write findings with add_note(text, function) while you work, and finish the item with
   complete_function(function, summary): what it does, inputs/outputs, calls, data and anything surprising.
4. release_function(function, notes) if it needs someone else; notes are required.

If the user added a task (one with no address), do exactly that task. Never write files, execute the target, or try
to compile: rea_tool only exposes read-only analysis. Be brief in your messages: work, don't narrate.
Guides: {guides}.
"""

WORK_PROMPT = """\
You are a decompilation agent in decomp.anything, working on {title}. Other agents may be working on other
functions of the same {target} at the same time; the tools keep you from colliding.

Your job: turn functions of this {target} into {language} that compiles to *exactly* the original machine code.
Use only the decomp tools. Repeat for up to {count} claims (a batch is one), then stop:

1. claim_function(count=4) gives you the next function, and when it's small, its neighbours with it (small
   functions mostly match on the first try): assembly, location, calls, data it uses, the best previous
   attempt and notes (start from those!), a machine-generated draft, and identical matched code if any.
2. get_context() shows the shared header every compile includes. Lost? search_facts("name, string, API or address")
   and list_subsystems() point at the relevant code without address-by-address searching.
3. Write the {language} functions (same names as the assembly) and judge them: compile_and_diff(function="a, b, c",
   source=all the definitions) for a batch, one name for one. Read the diff: '<' '>' missing/extra
   instructions, 'i' operands, 'o' order, 'r' registers, 's' stack. Fix structure first, registers last.
   The workflow and {compiler_guide} guides are below. find_similar(function) shows look-alike functions;
   a matched one is the best starting point.
4. Score 0 = matched and saved. Before moving on, share what you learned: edit_context for prototypes and
   structs you worked out, rename_symbol for functions/data whose purpose is now clear, and add_note (no
   function) for a compiler quirk or convention every agent here should know: the next sessions start with it.
5. compile_and_diff says when to move on (no better after 4 compiles in a row; up to 10 for big functions):
   then release_function with precise notes (what you tried, what is left) and claim the next one.

Write plausible original code, pure {language} (no inline asm).{language_note}
Be brief in your messages: work, don't narrate.
"""

FORK_PROMPT = """\
You are a decompilation agent in decomp.anything, continuing {title}: a public matching-decompilation project
for {platform}. Other agents may be working on other functions of the same project at the same time; the
tools keep you from colliding.

Your job: write functions in the project's own source files so they compile to *exactly* the original
machine code, judged by objdiff. Use only the decomp tools. Repeat for up to {count} claims (a batch is one), then stop:

1. claim_function(count=4) gives you the next function, and when it's small, its neighbours in the same
   file (small functions mostly match on the first try): target assembly, the current diff, its source
   file, the best previous attempt and notes (start from those!), functions already matched in that file,
   and identical matched code elsewhere if there is any.
2. The brief usually has what you need. When it doesn't: search_facts / read_file on the source file and its headers,
   search_code for the types, structs and helpers it uses. Reuse what exists; never redefine it.
   find_similar(function) finds look-alike functions: start from a matched one.
3. compile_and_diff(function, source) with the complete definition (plus any #include "...", prototypes
   or #pragma lines it needs); several at once: function="a, b, c" with all definitions in source. Each
   goes into the source file in place of the old one, the file is built with the project's compiler and
   diffed. Fix structure first (control flow, calls), then types and expressions, registers last.
4. 100% = matched, committed to git. Structs, prototypes, globals or helpers you need go in with
   edit_file (a header or the top of the source file); an edit that breaks any match is undone. Found a
   compiler quirk or project convention others should know? add_note with no function: every new session
   starts with those notes.
5. The goal is linked files: the game built from the C, byte for byte. When a match finishes a file's
   functions, you're shown its data next to the original's: fix what differs (order, const, statics,
   values) with edit_file until file_status says it matches; decomp.anything then links the file.
6. compile_and_diff says when to move on (no better after 4 compiles in a row; up to 10 for big functions):
   then release_function with precise notes (what you tried, what is left) and claim the next. Very large
   functions: get the structure right first; a near miss is worth the extra compiles.

Rules: C/C++ only (no inline asm, asm functions or asm includes); don't touch targets, configs or build
scripts (the tools refuse). Write code a human would have written: match the file's style and names.
Guides: {guides}. Be brief in your messages: work, don't narrate.
"""


def _guide(topic: str = "") -> str:
    topic = topic.strip().lower()
    if topic not in GUIDES:
        listing = "\n".join(f"- {k}: {v}" for k, v in GUIDES.items())
        return f"Guides (call guide with one of these topics):\n{listing}"
    return resources.files("decompnet.app").joinpath("guide", f"{topic}.md").read_text(encoding="utf-8")


def _fork(net: RomNetwork, slug: str, what: str) -> str:
    if not net.fork_slug(slug):
        raise NetworkError(f"{what} is for forks of public decomps; in a ROM project the shared header is get_context")
    return slug


def _refs(net: RomNetwork, slug: str) -> list:
    if not (roots := net.references(slug)):
        raise NetworkError("this project has no reference folders: the user can name one (its full path) in the "
                           "project's instructions")
    return roots


def _read_file(net: RomNetwork, slug: str, path: str, start: int = 1, count: int = 200) -> str:
    if net.fork_slug(slug):
        return net.forks.read_file(slug, path, start, count)
    return references.read(_refs(net, slug), path, start, count)


def _search_code(net: RomNetwork, slug: str, pattern: str, glob: str = "") -> str:
    if net.fork_slug(slug):
        return net.forks.search(slug, pattern, glob)
    return references.search(_refs(net, slug), pattern, glob)


def project_info(net: RomNetwork, slug: str) -> str:
    wish = net.instructions(slug)
    text = _project_info(net, slug)
    if (facts := net.intake_line(slug)):
        text += "\n" + facts
    text += f"\nThe user's instructions for this project (they come first):\n{wish}" if wish else ""
    return text + (f"\n{references.prompt_line(roots)}" if (roots := net.references(slug)) else "")


def _project_info(net: RomNetwork, slug: str) -> str:
    if net.fork_slug(slug):
        return net.forks.info(slug)
    ov = net.overview(slug)
    if ov.get("kind") == "analysis":
        target = (ov.get("analysis") or {}).get("target") or {}
        return (f"{ov['title']} — {target.get('format') or 'file'} {target.get('architecture') or ''}\n"
                f"target: {target.get('path')}\n"
                f"progress: {ov['matched']}/{ov['functions']} work items analyzed, {ov.get('findings', 0)} findings\n"
                f"Next: claim_function(). Guides: guide(\"analysis\").")
    pct = 100 * ov["matched_bytes"] / (ov["bytes"] or 1)
    source = (ov.get("source_language") or "C") + (f" ({ov['source_ext']})" if ov.get("source_ext") else "")
    return (f"{ov['title']} ({ov['rom']['game_code']}, {ov['rom']['region']})\n"
            f"compiler: {ov['compiler']['name']} {' '.join(ov['compiler']['flags'])}\n"
            f"source: {source}\n"
            f"progress: {ov['matched']}/{ov['functions']} functions matched ({pct:.1f}% of code), "
            f"{ov['attempts']} compiles so far, context.h v{ov['context_version']}\n"
            f"Next: claim_function(). Guides: guide().")


# name -> handler(net, agent, slug, **args); every handler returns text for the model
def _claim(net: RomNetwork, agent: Agent, slug: str, function: str, strategy: str, count: int = 1) -> str:
    """A claim; one asked for that's matched, hand-written assembly or someone else's is the next free function
    instead (an agent asking for those has nothing better to do than the next one, and is told why). count > 1: a
    batch of small ones."""
    strategy = strategy or ("finish" if net.fork_slug(slug) else "easiest")
    if not function and int(count or 1) > 1:
        return net.claim_many(agent, slug, int(count), strategy)
    try:
        return net.claim(agent, slug, function or None, strategy)
    except NetworkError as e:
        if not function or not re.search(r"already matched|is hand-written assembly|is claimed by", str(e)):
            raise
        return f"({e}. Here's the next free function instead.)\n\n" + net.claim(agent, slug, None, strategy)


def _compile(net: RomNetwork, agent: Agent, slug: str, function: str, source: str) -> str:
    """compile_and_diff; several names ("a, b, c") judge several definitions sent together."""
    if net.is_analysis(net._project(slug)):
        return ("This is an analysis project: there is no compiler or original build. Read the work item with "
                "get_function, go deeper with rea_tool, then complete_function(function, summary).")
    names = [n.strip() for n in function.split(",") if n.strip()]
    if len(names) <= 1:
        return net.compile_and_diff(agent, names[0] if names else function, source, slug)
    return net.attempt_many(agent, [net.resolve_function(agent, slug, n) for n in names], source, slug)


def _rea_tool(net: RomNetwork, agent: Agent, slug: str, tool: str, arguments=None) -> str:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments or "{}")
        except ValueError:
            return "error: arguments must be a JSON object"
    if not isinstance(arguments, dict):
        return "error: arguments must be a JSON object"
    return net.analysis_tool(slug, tool, arguments)


HANDLERS: dict[str, Callable[..., str]] = {
    "project_info": lambda net, agent, slug: project_info(net, slug),
    "claim_function": lambda net, agent, slug, function="", strategy="", count=1:
        _claim(net, agent, slug, function, strategy, count),
    "get_function": lambda net, agent, slug, function: net.get_function(function, slug, agent),
    "compile_and_diff": lambda net, agent, slug, function, source: _compile(net, agent, slug, function, source),
    "complete_function": lambda net, agent, slug, function, summary:
        net.complete_analysis(agent, slug, function, summary),
    "rea_tool": lambda net, agent, slug, tool, arguments=None:
        _rea_tool(net, agent, slug, tool, arguments),
    "read_artifact_entry": lambda net, agent, slug, entry, offset=0, length=256:
        net.analysis_read_entry(slug, entry, offset, length),
    "write_source": lambda net, agent, slug, function, source: net.write_source(agent, slug, function, source),
    "release_function": lambda net, agent, slug, function, notes: net.release(agent, function, notes, slug),
    "get_context": lambda net, agent, slug, function="": net.get_context(slug, function or None),
    "edit_context": lambda net, agent, slug, old, new, message, function="":
        net.edit_context(agent, slug, old, new, message, function or None),
    "rename_symbol": lambda net, agent, slug, old, new, message="": net.rename_symbol(agent, slug, old, new, message),
    "split_function": lambda net, agent, slug, function, at, new_name="":
        net.split_function(agent, slug, function, at, new_name),
    "merge_function": lambda net, agent, slug, function, into="": net.merge_function(agent, slug, function, into),
    "retire_function": lambda net, agent, slug, function, reason: net.retire_function(agent, slug, function, reason),
    "inspect_binary": lambda net, agent, slug, function, what="": net.inspect_binary(slug, function, what),
    "search_binary": lambda net, agent, slug, query: net.search_binary(slug, query),
    "read_data": lambda net, agent, slug, what, length=64: (net.forks.read_data(agent, slug, what, length)
                                                            if net.fork_slug(slug) else net.read_data(slug, what, length)),
    "list_functions": lambda net, agent, slug, status="open", limit=40: net.list_functions(slug, status, limit),
    "search_facts": lambda net, agent, slug, query, limit=40: net.search_facts(slug, query, limit),
    "list_subsystems": lambda net, agent, slug, limit=12: net.subsystem_text(slug, limit),
    "add_note": lambda net, agent, slug, text, function="": net.add_note(agent, slug, text, function or None),
    "search_notes": lambda net, agent, slug, query: net.search_notes(slug, query),
    "find_similar": lambda net, agent, slug, function, limit=5: net.find_similar(slug, function, limit),
    "guide": lambda net, agent, slug, topic="": _guide(topic),
    "read_file": lambda net, agent, slug, path, start=1, count=200: _read_file(net, slug, path, start, count),
    "search_code": lambda net, agent, slug, pattern, glob="": _search_code(net, slug, pattern, glob),
    "edit_file": lambda net, agent, slug, path, old, new, message:
        net.forks.edit_file(agent, _fork(net, slug, "edit_file"), path, old, new, message),
    "file_status": lambda net, agent, slug, path: net.forks.file_status(_fork(net, slug, "file_status"), path),
    "split_file": lambda net, agent, slug, path, at, new_name="", data="":
        net.forks.split_file(agent, _fork(net, slug, "split_file"), path, at, new_name, data),
    "import_debug_info": lambda net, agent, slug, path="": json.dumps(net.import_debug_info(slug, path)),
    "export_debug_info": lambda net, agent, slug: json.dumps(net.export_debug_info(slug)),
    "compare_version": lambda net, agent, slug, path: json.dumps(net.compare_version(slug, path)),
    "list_data": lambda net, agent, slug, query="", limit=100: _data_text(net.data_symbols(slug, query, limit)),
    "import_trace": lambda net, agent, slug, path: json.dumps(net.import_trace(slug, path)),
    "list_hot": lambda net, agent, slug, limit=40: _hot_text(net.hot_functions(slug, limit)),
}

ROM_ONLY = {"get_context", "edit_context", "rename_symbol", "split_function", "merge_function", "retire_function",
            "import_debug_info", "export_debug_info", "compare_version", "write_source"}
FORK_ONLY = {"edit_file", "file_status", "split_file"}
ANALYSIS_ONLY = {"complete_function", "rea_tool", "read_artifact_entry"}
ANALYSIS_TOOLS = {"project_info", "claim_function", "get_function", "release_function", "complete_function",
                  "rea_tool", "read_artifact_entry", "write_source", "inspect_binary", "search_binary", "read_data",
                  "list_functions", "add_note", "search_notes", "guide", "read_file", "search_code", "search_facts"}


def _hot_text(rows) -> str:
    if not rows:
        return "No runtime coverage has been imported."
    return "\n".join(f"- {r['hits']:>8}  {r['name']}  0x{r['vram']:08X}" for r in rows)


def _data_text(rows) -> str:
    if not rows:
        return "No data symbols match."
    return "\n".join(f"- 0x{r['address']:08X}  {r['name']}  ({r['kind']}, {r['size']} bytes)"
                      + (f"  {r['preview']}" if r.get("preview") else "") for r in rows)


def tool_names(fork: bool = False, analysis: bool = False) -> list[str]:
    """The tools that make sense for a project: forks, analysis targets and matching projects share the core loop."""
    if analysis:
        return [n for n in HANDLERS if n in ANALYSIS_TOOLS]
    skip = (ROM_ONLY if fork else FORK_ONLY) | ANALYSIS_ONLY
    return [n for n in HANDLERS if n not in skip]


def _named(net: RomNetwork, agent: Agent, slug: str, args: dict) -> dict:
    """Function names as agents write them (a plain symbol that repeats across files, symbol@unit, Class::method)
    turned into the stored name, preferring the function the agent holds."""
    if args.get("function") and "," not in args["function"]:  # (several are resolved one by one, see _compile)
        args = {**args, "function": net.resolve_function(agent, slug, args["function"])}
    return args


def call(net: RomNetwork, agent: Agent, slug: str, name: str, args: dict) -> str:
    """Run one tool for the built-in agent; errors come back as text the model can act on."""
    if name not in HANDLERS:
        return f"error: unknown tool {name!r}"
    try:
        return HANDLERS[name](net, agent, slug, **_named(net, agent, slug, args))
    except NetworkError as e:
        return f"error: {e}"
    except TypeError as e:
        return f"error: bad arguments for {name}: {e}"


# Antigravity CLI otherwise finds MCP tools on demand (an extra step each, through its generic dispatcher):
# decomp.anything's tools are all there is to the job, so they are loaded up front.
ALWAYS_LOAD = {"antigravity/alwaysLoad": True}


def build_mcp(net: RomNetwork, agent_of: Callable[[Context], tuple[Agent, str]]) -> MCPServer:
    """MCP server for CLI agents. `agent_of` maps a request to (agent, project slug)."""
    mcp = MCPServer(name="decomp", title="decomp.anything", instructions=INSTRUCTIONS, version=__version__)

    async def run(ctx: Context, name: str, **args) -> str:
        try:
            agent, slug = agent_of(ctx)
        except NetworkError as e:
            raise ToolError(str(e)) from None
        try:
            return await anyio.to_thread.run_sync(lambda: HANDLERS[name](net, agent, slug, **_named(net, agent, slug, args)))
        except NetworkError as e:
            raise ToolError(str(e)) from None

    @mcp.tool(meta=ALWAYS_LOAD)
    async def project_info(ctx: Context) -> str:
        """Which game you're working on, its compiler, and progress so far."""
        return await run(ctx, "project_info")

    @mcp.tool(meta=ALWAYS_LOAD)
    async def claim_function(ctx: Context, function: str = "", strategy: str = "", count: int = 1) -> str:
        """Claim the next function to decompile (or a specific one by name or address).

        Returns its assembly, the best previous attempt and notes from earlier agents, plus (ROM projects)
        calls, data and a machine-made draft or (forks) the current diff and its source file. Each compile
        renews the claim.

        Args:
            function: optional name or address (0x80001234) of a specific function
            strategy: finish (forks' default: the files closest to being linked first), easiest (fewest
                instructions; ROM projects' default), closest (nearly matched already), hardest, random
            count: up to 6: small functions come as a batch (neighbours in one file) to write together and
                judge in one compile_and_diff; a big one comes alone
        """
        return await run(ctx, "claim_function", function=function, strategy=strategy, count=count)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def get_function(ctx: Context, function: str) -> str:
        """Show any function (by name or address): assembly, status, best attempt, notes. Read matched
        functions to learn how this codebase is written."""
        return await run(ctx, "get_function", function=function)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def compile_and_diff(ctx: Context, function: str, source: str) -> str:
        """Compile your code for `function` and diff it against the original; score 0 = byte-identical.

        ROM projects: compiled with the game's compiler (context.h included), linked at the function's
        address and compared with the ROM. Forks: send the complete definition (plus any #include "...",
        prototypes, externs or #pragma lines it needs); it replaces the function in its source file, which is
        built with the project's build system and diffed with objdiff. Several functions ("a, b, c"): send all
        their definitions in one source; each is judged on its own."""
        return await run(ctx, "compile_and_diff", function=function, source=source)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def complete_function(ctx: Context, function: str, summary: str) -> str:
        """Analysis projects: mark a work item analyzed and save the finding (what it does, calls, data, surprises).
        The summary is kept on the item and in the project's notes for every other agent."""
        return await run(ctx, "complete_function", function=function, summary=summary)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def rea_tool(ctx: Context, tool: str, arguments: str = "{}") -> str:
        """Analysis projects: run one read-only REA tool on the target (search_strings, search_procedures,
        analyze_function, xrefs, procedure_callers, procedure_callees, list_segments, read_bytes, inspect_native_api,
        batch_decompile, get_call_graph, trace_call_path, trace_feature, trace_native_values, search_bytes).
        `arguments` is a JSON object; the answer comes back as text."""
        try:
            args = json.loads(arguments or "{}")
        except ValueError:
            raise ToolError("arguments must be a JSON object, for example {\"pattern\": \"socket\"}") from None
        if not isinstance(args, dict):
            raise ToolError("arguments must be a JSON object")
        return await run(ctx, "rea_tool", tool=tool, arguments=args)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def write_source(ctx: Context, function: str, source: str) -> str:
        """Save code you reconstructed for a work item that can't be verified byte for byte.

        The code is written into the project's `recovered/` tree and labelled reconstructed: not original source,
        and in a matching project never counted as a match (compile_and_diff is still the test, and a byte-exact
        match replaces it). Claim the work item first. The item is a whole module in an app or archive project, a
        procedure or task in an analyzed binary, and one function in a matching project.

        Args:
            function: the work item, exactly as claim_function showed it (src/main.js, or a function name)
            source: the complete module, or the function's source
        """
        return await run(ctx, "write_source", function=function, source=source)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def read_artifact_entry(ctx: Context, entry: str, offset: int = 0, length: int = 256) -> str:
        """Archive analysis projects: read one file entry in place, without extracting the archive.

        Args:
            entry: exact archive path, as shown by the work item (for example locale/en-US.json)
            offset: byte offset inside the entry
            length: bytes to read, up to 8192
        """
        return await run(ctx, "read_artifact_entry", entry=entry, offset=offset, length=length)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def release_function(ctx: Context, function: str, notes: str) -> str:
        """Give up a function you're stuck on. Notes are required: what you tried, what is left. Your best
        attempt is kept for the next agent."""
        return await run(ctx, "release_function", function=function, notes=notes)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def get_context(ctx: Context, function: str = "") -> str:
        """The shared header (types, structs, prototypes) included before every compile."""
        return await run(ctx, "get_context", function=function)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def edit_context(ctx: Context, old: str, new: str, message: str, function: str = "") -> str:
        """Edit the shared header: replace `old` (must occur exactly once) with `new`, or append `new` when
        old is "". Accepted only if every matched function still matches. Add prototypes and structs here."""
        return await run(ctx, "edit_context", old=old, new=new, message=message, function=function)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def rename_symbol(ctx: Context, old: str, new: str, message: str = "") -> str:
        """Give a function or data address a real name (e.g. func_80001234 -> player_update). Updates the
        assembly everyone sees, matched sources and the header; never breaks a match."""
        return await run(ctx, "rename_symbol", old=old, new=new, message=message)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def split_function(ctx: Context, function: str, at: str, new_name: str = "") -> str:
        """Split a function the disassembler merged with the next one (e.g. after a function that never
        returns). `at` is the address where the second function starts."""
        return await run(ctx, "split_function", function=function, at=at, new_name=new_name)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def merge_function(ctx: Context, function: str, into: str = "") -> str:
        """Put a piece of a function back where it belongs (PC programs). A 32-bit function can be split
        into fragments by an old import: if `function` has no prologue or ret and `into` is the function it
        is a slice of, merge it, then decompile `into` whole. Don't merge matched functions."""
        return await run(ctx, "merge_function", function=function, into=into)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def retire_function(ctx: Context, function: str, reason: str) -> str:
        """Take a function no C can reproduce out of the queue for good: give the evidence (the target's
        MSVC-only instruction, the call into the middle of another function, ...). It won't be claimed again.
        Use release_function when someone else might still match it."""
        return await run(ctx, "retire_function", function=function, reason=reason)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def inspect_binary(ctx: Context, function: str, what: str = "") -> str:
        """Ask REA for a work item's dossier: pseudocode, signature, callers, references. Matching projects also
        get decomp.anything's own assembly and cross references. Needs REA installed and configured.

        Args:
            function: name or address (0x140001000)
            what: all (default), info, pseudocode, assembly, callers, callees, references (analysis: always all)
        """
        return await run(ctx, "inspect_binary", function=function, what=what)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def search_binary(ctx: Context, query: str) -> str:
        """Find strings and procedure names in the target (REA's inventories when it is set up; in analysis
        projects always REA). Useful before naming a function or a global."""
        return await run(ctx, "search_binary", query=query)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def read_data(ctx: Context, what: str, length: int = 64) -> str:
        """Hex dump of the original's data: an address or symbol (ROM projects), a data symbol such as
        lbl_1_data_10 (forks); text, pointers and floats decoded."""
        return await run(ctx, "read_data", what=what, length=length)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def list_functions(ctx: Context, status: str = "open", limit: int = 40) -> str:
        """List functions by status: open, matched or all."""
        return await run(ctx, "list_functions", status=status, limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def search_facts(ctx: Context, query: str, limit: int = 40) -> str:
        """Search function names, symbols, strings, imported APIs and addresses in one call. Returns functions
        with call/callee counts and symbols with the functions that use them. Use it before naming something."""
        return await run(ctx, "search_facts", query=query, limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def list_subsystems(ctx: Context, limit: int = 12) -> str:
        """Group functions by the imported APIs and strings they use (render, audio, input, network, file,
        UI, memory, threading, crypto). A starting point for tasks, not a proof."""
        return await run(ctx, "list_subsystems", limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def add_note(ctx: Context, text: str, function: str = "") -> str:
        """Leave a note for other agents, on a function or the whole project."""
        return await run(ctx, "add_note", text=text, function=function)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def search_notes(ctx: Context, query: str) -> str:
        """Search notes left by agents."""
        return await run(ctx, "search_notes", query=query)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def find_similar(ctx: Context, function: str, limit: int = 5) -> str:
        """Functions whose instructions look like this one's (copy-pasted code, the same inlined helper,
        template instances), matched ones first, with the matching source of the best one. Start there."""
        return await run(ctx, "find_similar", function=function, limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def guide(ctx: Context, topic: str = "") -> str:
        """Decompilation know-how. Call without a topic for the list (workflow, mips, gcc-kmc, ido, m2c,
        data, structs, n64, naming)."""
        return await run(ctx, "guide", topic=topic)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def read_file(ctx: Context, path: str, start: int = 1, count: int = 200) -> str:
        """Read a file with line numbers (a folder: what's in it). Forks: the project's files, path relative to
        its root. ROM projects: the reference folders the user named in the instructions (project_info lists
        them), path relative to the first one or absolute."""
        return await run(ctx, "read_file", path=path, start=start, count=count)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def search_code(ctx: Context, pattern: str, glob: str = "") -> str:
        """Search with a regular expression. Forks: the project's C/C++ sources and headers. ROM projects: the
        text files of the reference folders the user named (case-insensitive; an address as 0x401070).
        `glob` narrows the files (e.g. "include/**/*.h")."""
        return await run(ctx, "search_code", pattern=pattern, glob=glob)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def edit_file(ctx: Context, path: str, old: str, new: str, message: str) -> str:
        """Forks only: change a C/C++ source or header file. Replace `old` (exactly once) with `new`, or
        append `new` when old is "". The project is rebuilt and measured; the edit is undone if any matched
        function stops matching. Use it for structs, prototypes, globals and helpers."""
        return await run(ctx, "edit_file", path=path, old=old, new=new, message=message)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def file_status(ctx: Context, path: str) -> str:
        """Forks only: how far a source file (or a function's file) is from being linked into the game: which
        functions still differ, its data next to the original's (with what to fix), why the last link failed.
        A file is linked (the game built from its C) once every function and all its data match."""
        return await run(ctx, "file_status", path=path)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def import_debug_info(ctx: Context, path: str = "") -> str:
        """Import names and types that already exist beside the target: a PDB, ELF DWARF, a MAP file or
        symbol_addrs.txt. Empty path means the sidecar debug file (PDB next to an .exe, DWARF in an ELF).
        Debug names replace automatic sub_/func_ names without breaking matches; types go into the shared header."""
        return await run(ctx, "import_debug_info", path=path)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def export_debug_info(ctx: Context) -> str:
        """Write portable symbol_addrs.txt, debug_types.h and debug_symbols.json files into the project folder."""
        return await run(ctx, "export_debug_info")

    @mcp.tool(meta=ALWAYS_LOAD)
    async def import_trace(ctx: Context, path: str) -> str:
        """Import a debugger/emulator coverage file: addresses or function names with optional counts. Hits are
        mapped to functions and shown in the Data/Coverage UI; use list_hot to prioritize."""
        return await run(ctx, "import_trace", path=path)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def list_hot(ctx: Context, limit: int = 40) -> str:
        """Most-executed functions from the imported runtime traces, hottest first."""
        return await run(ctx, "list_hot", limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def list_data(ctx: Context, query: str = "", limit: int = 100) -> str:
        """List named data and strings in the target: address, name, kind, size and a preview. Use read_data
        for the bytes at one address; this is the inventory."""
        return await run(ctx, "list_data", query=query, limit=limit)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def compare_version(ctx: Context, path: str) -> str:
        """Compare the project's target with another build (a patch, demo or port): same, changed, added and
        removed functions, matched by normalized instructions so moved addresses don't hide a match."""
        return await run(ctx, "compare_version", path=path)

    @mcp.tool(meta=ALWAYS_LOAD)
    async def split_file(ctx: Context, path: str, at: str, new_name: str = "", data: str = "") -> str:
        """Forks only (GameCube/Wii): divide a source file in two where the game's original files divided: the
        function `at` (name or .text offset) and every one after it in the file go to a new file `new_name`
        (default: text_<offset> next to it), with their C. `data` moves the end of each data section too
        (".rodata:0x88 .data:0x28": where the new file's part starts; file_status shows the ranges). Kept only if
        the game still builds byte for byte and every match still matches. A file links only when its code and
        data are exactly one original file's."""
        return await run(ctx, "split_file", path=path, at=at, new_name=new_name, data=data)

    @mcp.prompt(title="Decompile", description="Work loop: claim functions and match them byte for byte.")
    def work(count: str = "5") -> str:
        return "Call project_info first, then follow the decomp.anything work loop for up to " + count + " functions."

    return mcp
