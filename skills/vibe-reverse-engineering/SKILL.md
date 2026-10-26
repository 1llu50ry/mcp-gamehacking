---
name: vibe-reverse-engineering
description: "Vibe Reverse Engineering -- LLM-friendly static + dynamic analysis for x86/x64 PE binaries built for agentic coding tools (Cursor, VSCode+Copilot, Claude Code, Kiro). Point an agent at an .exe and describe what you want. Static analysis in `retools/` (bundled Radare2) + live-process tooling in `livetools/` + ASI patcher scaffold."
metadata:
  type: tool-reference
  source: better-options/Vibe-Reverse-Engineering-master
  topics: [reverse-engineering, pe, radare2, mcp, llm-agents, static-analysis, dynamic-analysis]
---

# Vibe Reverse Engineering

LLM-first toolkit for x86/x64 PE binaries. "No RE experience required -- just good prompting." Bundled with Radare2 for Windows in `tools/`, so no separate install. Python 3.10+; Visual Studio 2022+ with C++ Desktop workload only when building ASI patches.

## Static Analysis (`retools/`)

Works directly on PE files on disk, no execution:

- `disasm.py`, `decompiler.py` -- disassembly + decompilation via r2 + pyghidra backend.
- `callgraph.py`, `cfg.py` -- call graph + control-flow graph extraction.
- `xrefs.py`, `datarefs.py`, `structrefs.py` -- xref kinds.
- `funcinfo.py`, `dumpinfo.py`, `context.py` -- function + binary summaries.
- `vtable.py`, `rtti.py` -- C++ RTTI + VTable recovery.
- `throwmap.py` -- MSVC exception map (`__CxxFrameHandler3`).
- `sigdb.py` -- signature DB; `kb.py` -- knowledge base over the project.
- `asi_patcher.py` -- ASI (GTA-style) patch skeleton.
- `pyghidra_backend.py` + `ghidra_server.py` + `ghidra_client.py` -- optional Ghidra bridge.
- `search.py`, `index.py`, `query.py` -- byte / string / pattern search with cached index.
- `readmem.py` -- offline memory layout queries.
- `dataflow.py` -- forward/backward data-flow slices.
- `bootstrap.py` -- project bootstrap for a new target.
- `common.py` -- shared primitives.

## Dynamic / Live Tooling (`livetools/`)

- `agent.js` -- Frida-style injected agent for live introspection.
- `analyze.py` -- live analysis orchestrator.
- `client.py` + `server.py` -- communication layer.
- `gamectl.py` -- game process control (attach, pause, snapshot).

## Why

- Agentic workflow: describe a feature, let the agent map imports, call graphs, and vtables, then produce an ASI patch.
- Pure Python + bundled Radare2 means Windows setup is one `pip install -r requirements.txt`.
- Both static and dynamic in one repo -- transition from file-on-disk to running-process without re-tooling.

## When to Use

- Windows game binary (PE) you want an agent to triage.
- You want to try before investing in IDA Pro licence.
- ASI-style patch target (community game modding).

## Related

Pairs with [[ida-pro-mcp]] / [[superghidra-mcp]] when you need deeper decomp quality, [[x64dbg-mcp-server]] for interactive debugging, and [[rea-reverse-engineer-anything]] for cross-tool orchestration. Preferred by `reverse-engineer` and the per-game specialist agents.
