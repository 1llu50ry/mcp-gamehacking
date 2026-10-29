# Reddit launch (ready to paste)

## r/ReverseEngineering

**Title**: `[Tool Release] mcp-reverse v4.6 — 111 MCP tools + 59 RE backends under one connection`

**Body**:

I built an MCP (Model Context Protocol) server that unifies the RE / debugging toolbelt. Highlights:

- **Native zero-dep TS parsers**: PE, ELF, Mach-O, DEX, WASM, Minidump, ZIP/APK, .NET, Unity AssetBundle, UE `.pak`, IL2CPP metadata, Switch NSO, PDB70. One tool `analyze_binary <path>` runs the full pipeline (format → entropy → strings → crypto constants → Rich Header → Debug Directory → symsrv URL).
- **MCP hub**: single connection point for Ghidra, IDA, Binja, radare2, x64dbg, WinDbg, Cheat Engine, Frida, Hopper, Volatility, angr, PCILeech, Memflow, YARA, Unicorn, Qiling, unidbg, AFL++, mitmproxy, Burp, dnSpy, ReClass.NET, FakePDB — 59 total. `smart_decompile` fails over through them.
- **Agent mesh**: Claude Code, Codex, Cursor, Copilot and custom agents collaborate on the same binary via DM / channels / tasks / votes / KB / locks.
- **BM25 search** over 4,200+ curated skill docs on BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet, mhyprot internals.

Repo: https://github.com/1llu50ry/mcp-reverse

MIT licensed. For security research, cheat detection, defensive work, education. Would love your eyes on the Debug Directory walker.

## r/REMath / r/exploitdev

**Title**: `[OSS] agent-mesh for RE — Claude + Codex + Cursor adversarially vote on each other's decompilation`

**Body**:

Dropping an MCP server that lets different models work on the same binary. Core primitives:

- `mesh_task_create from=A to=B title=... spec=...` — hand off work.
- `mesh_task_vote voter=C verdict=approve confidence=0.9` — three agents vote on each other's result.
- `hub_consensus_call matcher=decompile args={...}` — fan the same tool call out to IDA + Ghidra + Binja and compare.

Includes native parsers (PE/ELF/Mach-O/DEX/WASM/Minidump), BM25 search over 4,200 skills, symsrv auto-URL from PDB70, PCILeech/MemProcFS launcher, 59-backend hub. Zero npm deps for mesh persistence (JSON on disk).

https://github.com/1llu50ry/mcp-reverse

Looking for critique on the voting algorithm — currently just sum of confidence per verdict. Should it be weighted by past accuracy?

## r/gamedev

**Title**: `[Tool] mcp-reverse — reverse-engineer game binaries with Claude / Cursor / Codex collaborating`

**Body**:

Shipped a tool that helps game developers:

- Audit which of your symbols leaked into the PDB.
- Diff two shipped builds to see what offsets changed.
- Understand which anti-cheat detection vectors are in play.
- Scan for common cheat loader signatures in your binary.

Hooks into Ghidra / IDA / Binja / x64dbg / WinDbg / Frida / Cheat Engine via one MCP connection. Native parsers for PE / ELF / Mach-O / DEX / Unity AssetBundle / UE `.pak` / IL2CPP metadata built in.

https://github.com/1llu50ry/mcp-reverse

MIT. Would love feedback on the Unity + UE workflows.
