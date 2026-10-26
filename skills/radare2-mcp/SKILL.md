---
name: radare2-mcp
description: "radare2 MCP (r2mcp / r2pipe-mcp) -- MCP bridge over radare2's r2pipe. Agent-callable r2 commands: afl (functions), pdf (decompile), ax (xrefs), /x (byte search), aei (ESIL), etc. Static + dynamic (r2 debug mode). Cross-platform, free."
metadata:
  type: tool-reference
  source: external/radare2
  topics: [radare2, r2, mcp, static, dynamic, esil]
---

# radare2 MCP

MCP bridge over r2pipe. Lets an agent execute radare2 commands against an open binary (`afl`, `pdf`, `agf`, `ax`, `/x`, `aei`, `s`, `ii`, `is`) and dynamic debug commands (`do`, `dc`, `ds`, `db`, `dr`, `dm`).

## Operating Model

- Backend: `r2mcp` (Node) or `r2pipe-mcp` (Python). Spawns `r2` under the hood.
- Scriptable through r2's command language.
- Supports ESIL (emulated symbolic execution).

## Core Tools (through this project)

- `launch_re_backend id=radare2-mcp`
- `re_http_call id=radare2-mcp path=/cmd` with a JSON `{ "cmd": "pdf @ main" }`

## When to Use

- No budget for IDA Pro, don't want JVM for Ghidra.
- Want scriptable, pipeline-friendly RE in a CI/CD workflow.
- ESIL for symbolic reasoning without going to angr.

## Related

Alternative to [[ida-pro-mcp]] / [[superghidra-mcp]]. Bundled under `tools/vendor/vibe-re/tools/` (Windows). Pairs with [[frida-mcp]] for dynamic.
