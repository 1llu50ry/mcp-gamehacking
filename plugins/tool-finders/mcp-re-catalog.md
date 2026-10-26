---
name: mcp-re-catalog
description: Catalog of reverse-engineering and debugging MCP backends drivable from this server -- Ghidra (GhidraMCP, SuperghidraMCP), IDA Pro (community + Hex-Rays), Binary Ninja, radare2, x64dbg, WinDbg, Cheat Engine, Frida, Hopper, REA, Vibe-RE, JADX, angr, Capstone.
type: tool-plugin
---

# Plugin: mcp-re-catalog

Catalog of RE / debug MCP backends. Exposed at runtime by the server's own `list_re_backends`, `describe_re_backend`, `pick_re_backend`, and `re_mcp_config` tools (see `src/retools.ts`).

## Entries

| Backend | Skill | Kind | OS | Headline Feature |
|---|---|---|---|---|
| GhidraMCP (LaurieWired) | [[superghidra]] (sibling) | Static | Win/Linux/macOS | Jetty inside Ghidra GUI; first-gen |
| SuperghidraMCP (pyghidra-mcp) | [[superghidra-mcp]] | Static | Win/Linux/macOS | 38-tool server; ChromaDB semantic search; `--gui` live attach |
| ida-pro-mcp (mrexodia) | [[ida-pro-mcp]] | Static | Win/Linux/macOS | Rich IDA bridge; deprecated in favor of Hex-Rays |
| Hex-Rays IDA MCP (official) | [[ida-pro-mcp]] | Static | Win/Linux/macOS | Vendor-supported, preferred when available |
| Binary Ninja MCP | [[binary-ninja-mcp]] | Static | Win/Linux/macOS | HLIL / MLIL / LLIL over MCP |
| radare2 MCP | [[radare2-mcp]] | Both | Win/Linux/macOS | r2 commands + ESIL |
| x64dbg MCP Server | [[x64dbg-mcp-server]] | Dynamic | Windows | SSE push; strict state discipline |
| WinDbg MCP | [[windbg-mcp]] | Dynamic | Windows | KM debug, crash-dump, dbgeng |
| Cheat Engine MCP | [[cheat-engine-mcp]] | Both | Win/Linux/macOS | AoB + pointer scan + Lua eval |
| Frida MCP | [[frida-mcp]] | Dynamic | Win/Linux/macOS/Android/iOS | Interceptor + ObjC + Java bridges |
| Hopper MCP | [[hopper-mcp]] | Static | macOS/Linux | Primary for Mach-O / iOS |
| REA | [[rea-reverse-engineer-anything]] | Both | Win/Linux/macOS | Cross-stack (native + Electron + .NET) |
| Vibe-RE | [[vibe-reverse-engineering]] | Both | Windows | Vendored under `tools/vendor/vibe-re` |
| JADX MCP | [[jadx-mcp]] | Static | Win/Linux/macOS | Android APK -> Java |
| angr MCP | [[angr-mcp]] | Static | Win/Linux/macOS | Symbolic execution; VEX IR |
| Capstone MCP | [[capstone-mcp]] | Static | Win/Linux/macOS | Lightweight disassembler for shellcode |

## Picking a Backend

- **Static, Ghidra-first** -> [[superghidra-mcp]].
- **Static, Hex-Rays-first** -> official Hex-Rays IDA MCP, else [[ida-pro-mcp]].
- **Static, Binja-first** -> [[binary-ninja-mcp]].
- **Static, scriptable, free** -> [[radare2-mcp]] or [[capstone-mcp]].
- **Static, cross-stack** -> [[rea-reverse-engineer-anything]].
- **Dynamic, Windows usermode** -> [[x64dbg-mcp-server]].
- **Dynamic, Windows kernel / crash dump** -> [[windbg-mcp]].
- **Dynamic, cross-platform scripting** -> [[frida-mcp]].
- **Dynamic, live memory scan / pointer walk** -> [[cheat-engine-mcp]].
- **Android APK** -> [[jadx-mcp]] + [[frida-mcp]].
- **iOS / macOS** -> [[hopper-mcp]] + [[frida-mcp]].
- **Symbolic / deobfuscation** -> [[angr-mcp]].

## Server-Side Tools

The MCP tools below are implemented in `src/retools.ts` and registered in `src/index.ts`:

- `list_re_backends`, `describe_re_backend`, `pick_re_backend`, `re_mcp_config`
- `launch_re_backend`, `stop_re_backend`, `re_backend_status`, `re_backend_health`
- `re_http_call`
- `x64dbg_cmd`, `ghidra_decompile`, `cheat_engine_aob`, `frida_eval`
- `vibe_re_run`, `ida_run_script`, `ghidra_run_script`

## Related Agents

Dispatched by `reverse-engineer`, `ida-specialist`, `ghidra-specialist`, `malware-analyst`, `obfuscation-analyst`, `exploit-developer`, `android-researcher`, `windows-internals-agent`, and the per-game specialists when they need to attach, decompile, trace, or instrument.

## Related Prompts

Powers `analyze-cheat`, `reverse-binary`, `analyze-update`, `reverse-unreal-game`, `reverse-unity-game`.

<!-- enriched:v2 -->
