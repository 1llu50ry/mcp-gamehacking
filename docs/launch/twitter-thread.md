# Twitter / X launch thread (ready to paste)

**Tweet 1 (hook — hero shot):**
> 🧠 Claude, Codex, and Cursor now reverse-engineer binaries together.
>
> Introducing mcp-gamehacking — one MCP server, 111 native tools, 59 RE/debug backends, multi-agent mesh.
>
> 100% MIT, zero deps for the core.
>
> 🧵 👇

**Tweet 2 (the pain):**
> Reversing a modern game needs IDA + Ghidra + x64dbg + WinDbg + Cheat Engine + Frida + Volatility + mitmproxy + a hex editor + 20 open tabs.
>
> Switching between them costs more hours than the actual RE.

**Tweet 3 (the fix):**
> One MCP connection replaces all that.
>
> • `analyze_binary notepad.exe` → format + Rich Header + Debug Directory + entropy + strings + crypto constants
> • `smart_decompile 0x401000` → fails over through IDA → Ghidra → Binja → RetDec
> • `pdb70_identify` → ready-to-fetch MS symsrv URL

**Tweet 4 (the multi-agent part):**
> The best part: three models share one workspace.
>
> Claude hands a task to Codex. Codex solves it. Cursor votes on the result. Weighted consensus returns to Claude.
>
> Think GitHub for RE, but the committers are models.

**Tweet 5 (numbers):**
> ✅ 111 MCP tools
> ✅ 59 RE/debug backends (Ghidra, IDA, x64dbg, Frida, PCILeech, Volatility, YARA, …)
> ✅ 4,200+ curated skills (BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet)
> ✅ Zero-dep PE/ELF/Mach-O/DEX/WASM/Minidump/Unity/UE parsers
> ✅ Docker multi-arch, HTTP + stdio, /metrics, /healthz

**Tweet 6 (ethical framing):**
> This is for security research, cheat *detection*, defensive engineering, education.
>
> Not a cheat. Doesn't drive gameplay. Doesn't ship exploits. Use it on binaries you own or are authorized to analyze.

**Tweet 7 (link + CTA):**
> ⭐ MIT, free, open to contrib
> → https://github.com/whory/mcp-gamehacking
>
> If you've reversed a game binary this year — this is for you.
>
> RT if you want a 3-min demo video.

**Reply (pin it) — the demo GIF:**
> [attach a 20-second screen cap of `analyze_binary` on a packed binary]

---

## Repost accounts to tag

- @simonw (Simon Willison picks up MCP projects)
- @HexRaysSA (IDA official — they boost RE)
- @binaryninja
- @ghidra_sre
- @anthropic (MCP origin)
- @cursorchats
- @OpenAIDevs
- @reverseengr
- @malwaretech
- @stok (bug bounty audience)
