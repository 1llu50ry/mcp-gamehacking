# Hacker News launch (ready to paste)

**Title (choose one):**

- `Show HN: Mcp-gamehacking – an MCP server that unifies 59 RE/debug tools`
- `Show HN: Multi-agent reverse engineering over MCP – Claude, Codex, Cursor collaborate`

**Body:**

I spent a few months collapsing my game-RE toolbelt into one MCP server. The result:

- **111 native MCP tools**: zero-dep TypeScript parsers for PE, ELF, Mach-O, DEX, WebAssembly, Minidump, ZIP/APK, .NET metadata, Unity AssetBundle, UE `.pak`, IL2CPP, Switch NSO. AoB scan, Shannon entropy, crypto-constant ID, IDA-style signature maker, PDB70 → Microsoft symbol-server URL.
- **59 external RE/debug backends** in a hub catalog (Ghidra, SuperGhidra, IDA, Hex-Rays MCP, Binary Ninja, radare2, x64dbg, WinDbg, Cheat Engine, Frida, Hopper, REA, Volatility, YARA, angr, Unicorn, PCILeech, Memflow, Scylla, dnSpy, ReClass.NET, AFL++, Qiling, unidbg, Burp, mitmproxy, dolphin-dme, cemu-ipc, …). `smart_decompile` fails over between them.
- **Agent mesh**: Claude Code, Codex / ChatGPT, Cursor, Copilot, Gemini CLI register as agents, DM each other, hand off tasks, vote on each other's findings, share a KV knowledge base. Zero npm deps — state in a single JSON.
- **4,200+ skills**: 246 hand-written references on BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet, mhyprot, Hyperion, HVCI, EPT hooks, UE4/UE5 reflection, Source 2 schema, IL2CPP decryption. 3,985 archived open-source projects with full source dumps.
- **Transports**: stdio and streamable HTTP (`/healthz`, `/metrics`).
- **Docker**: multi-arch (amd64 + arm64), non-root, healthchecked.

**Why**: switching between IDA, Ghidra, x64dbg, Cheat Engine, Frida, mitmproxy, and Volatility costs more hours than the actual reversing. One MCP connection + one shared mesh fixes that.

**Repo**: https://github.com/whory/mcp-gamehacking

**Ethics**: security research, cheat *detection*, defensive engineering, education. Doesn't ship cheats and doesn't drive gameplay.

Would love feedback on the mesh protocol — specifically how adversarial voting plays out when one model is more confident than another.
