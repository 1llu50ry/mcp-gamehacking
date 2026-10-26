# Product Hunt launch (ready to paste)

**Tagline (max 60 chars):** `AI agents reverse-engineer binaries. Together.`

**Description (max 260 chars):**
> One MCP server. 111 native tools. 59 RE/debug backends.
>
> Claude, Codex, Cursor share a mesh — DM, hand off tasks, adversarially vote on findings. Free, MIT, zero deps for the core.

**Topics:** `developer-tools`, `security`, `artificial-intelligence`, `open-source`, `github`

**First comment (post as maker):**
> Hey PH!
>
> I spent months collapsing my reverse-engineering toolbelt into one MCP server. Before: 10 tools open, 20 tabs, lost context every time I switched. After: one connection in Claude / Cursor / Codex and the agents coordinate.
>
> **What's new:**
> - 111 native MCP tools (zero-dep PE/ELF/Mach-O/DEX/WASM/Minidump/Unity/UE parsers, AoB scan, Shannon entropy, crypto-constant ID, PDB70 → MS symsrv URL)
> - 59 backend catalog (Ghidra, IDA, Binja, radare2, x64dbg, WinDbg, Frida, Cheat Engine, Hopper, Volatility, PCILeech, YARA, angr, …)
> - Multi-agent mesh — three agents can register, DM each other, hand off tasks, vote on each other's work, share a KV knowledge-base
> - 4,200+ curated skills on BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet, mhyprot, UE4/UE5, Source 2, IL2CPP
>
> **For who:** anti-cheat engineers, security researchers, defensive ops, students learning RE, preservation teams.
>
> **Not for:** cheating in online games. The project ships no cheats and doesn't drive gameplay.
>
> MIT. Would love your feedback — specifically on the agent-mesh voting algorithm.

**Gallery items (upload in this order):**

1. Hero: README screenshot showing the Mermaid architecture + badges.
2. GIF: `analyze_binary notepad.exe` showing format + Rich Header + Debug Directory + entropy + strings in a single response.
3. GIF: three agents in the mesh — register, send messages, vote.
4. Screenshot: `hub_consensus_call matcher=decompile` fanning out across IDA + Ghidra + Binja with different results.
5. Screenshot: comparison table vs other MCP servers.

**Launch day timing:** Tuesday 12:01 AM PT, so you catch Pacific + European morning + Asia evening.
