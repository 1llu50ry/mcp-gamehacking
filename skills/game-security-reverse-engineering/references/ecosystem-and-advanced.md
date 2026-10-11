# Ecosystem And Advanced

## Disassembler Plugin Ecosystem

### IDA Pro Plugins
```
Categories found in README (> IDA Plugins, 150+ entries):
- Decompiler enhancers: HexRaysPyTools, HRDevHelper
- Type recovery: ClassInformer, auto_struct
- Signature: FLIRT, Lumina, IDA Signature Database
- Scripting: IDAPython, IDC, LazyIDA
- Visualization: IDAGraph, Lighthouse (coverage)
- Anti-obfuscation: D-810 (MBA), de-ollvm, Patfinder
- Game-specific: SDK loaders, structure importers
```

### Binary Ninja Plugins
```
- Sidekick, snippets, type libraries
- HLIL-based analysis scripts
- Custom architectures and loaders
- Headless analysis for batch processing
```

### Ghidra Plugins
```
- GhidraScript (Java/Python), Ghidra extensions
- Ghidraaas (Ghidra-as-a-Service)
- Type importers, signature matchers
- Firmware analysis (SVD loader, embedded)
```

### Radare2 / iaito Plugins
```
- r2pipe scripting (Python, JS, Rust)
- iaito: official radare2 Qt GUI
- r2ghidra: Ghidra decompiler integration
- r2dec: lightweight decompiler
```

### WinDbg Plugins
```
- SwishDbgExt, WinDbgX
- Time Travel Debugging (TTD) extensions
- !analyze extensions, custom formatters
- Kernel debugging helpers
```

### x64dbg Plugins
```
- ScyllaHide (anti-anti-debug)
- TitanEngine, x64dbgpy
- Trace plugins, pattern scanners
- Conditional breakpoint scripts
```

### Cheat Engine Plugins
```
- Mono/IL2CPP helpers
- Auto-assembler templates
- Structure dissectors
- Pointer scanner extensions
```

## MCP-Based RE Tools

```
The README's MCP server section and RE tool ecosystem now include
AI-assisted reverse engineering through Model Context Protocol:

- IDA MCP: AI agent controls IDA Pro (rename, annotate, navigate)
- Ghidra MCP: AI agent queries Ghidra decompilation and PCODE
- Binary Ninja MCP: AI agent interacts with Binary Ninja API
- radare2 MCP: AI agent drives r2 sessions via r2pipe
- x64dbg MCP: AI agent controls live debugging sessions

Workflow: LLM ↔ MCP server ↔ RE tool, enabling natural-language
queries like "find all functions calling CreateRemoteThread" or
"rename this function based on its decompiled logic"
```

## Binary Diffing

```
Tools for comparing binary versions (patch analysis, vulnerability research):
- BinDiff (Google): graph-based structural comparison
- Diaphora: IDA-based program comparison; matching quality requires validation
- ghidriff: Ghidra-based diffing, command-line and scriptable
- DarunGrim: patch analysis focused differ
- turbodiff: lightweight IDA diffing plugin

Use cases in game security:
- Tracking anti-cheat driver updates between versions
- Reviewing changed behavior and trust-boundary assumptions in supplied builds
- Comparing obfuscated builds to isolate logic changes
```

[Diaphora's maintainer documentation](https://github.com/joxeankoret/diaphora)
describes an IDA-based diffing tool; a comparative quality ranking requires a
specified benchmark and independently checked matches. Preserve tool/IDA versions,
both input hashes, architecture, compiler/optimization changes and unmatched
functions. Similarity scores and decompiled differences are candidate evidence;
corroborate a claimed semantic change before assigning security impact.
Source reviewed: 2026-09-09.

## Anti-Debug Techniques Catalog

### User-Mode Anti-Debug
```
- IsDebuggerPresent / CheckRemoteDebuggerPresent
- NtQueryInformationProcess (ProcessDebugPort, ProcessDebugFlags, ProcessDebugObjectHandle)
- NtSetInformationThread (ThreadHideFromDebugger)
- PEB.BeingDebugged, PEB.NtGlobalFlag, heap flags
- INT 2D, INT 3 scanning, OutputDebugString tricks
- Timing checks: rdtsc, QueryPerformanceCounter, GetTickCount64
- TLS callbacks for early detection
- Exception-based: unhandled exception filter, VEH chain inspection
- Parent process checks (csrss.exe verification)
- Self-debugging: NtCreateDebugObject
```

### Kernel-Mode Anti-Debug
```
- KdDebuggerEnabled / KdDebuggerNotPresent
- Debug register (DR0-DR7) monitoring and clearing
- KPROCESS.DebugPort zeroing
- NMI callbacks for debugger detection
- Hardware breakpoint detection via context inspection
```

### Anti-Debug Bypass Tools
```
- ScyllaHide: comprehensive anti-anti-debug (x64dbg/IDA/standalone)
- TitanHide: kernel-mode debugger hiding
- HyperHide: hypervisor-based anti-debug bypass
- SharpOD: OllyDbg anti-anti-debug plugin
```

## VMProtect/Themida Analysis

### Resources
- Devirtualization tools
- Control flow recovery
- Handler analysis techniques
- Unpacking methodologies

## ROP/Exploit Development

### Tools
- **ROPgadget**: Gadget finder
- **rp++**: Fast ROP gadget finder
- **angrop**: Automated ROP chain generation

---
