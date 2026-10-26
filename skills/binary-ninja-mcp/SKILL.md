---
name: binary-ninja-mcp
description: "Binary Ninja MCP -- bridge over an open BNDB. Exposes HLIL / MLIL / LLIL, functions, types, strings, xrefs through MCP tools. Needs Binary Ninja (commercial or free) and the companion Python package."
metadata:
  type: tool-reference
  source: external/binaryninja
  topics: [binja, binary-ninja, mcp, static, hlil, mlil, llil]
---

# Binary Ninja MCP

MCP server for Binary Ninja. Opens a `.bndb` project and lets an agent query HLIL / MLIL / LLIL, decompile functions, follow xrefs, enumerate types, set and read tags, patch bytes. Backend HTTP endpoint `127.0.0.1:9009`.

## Operating Model

- Binary Ninja GUI (or `binaryninja-headless`) owns the BNDB.
- The MCP server exposes the Python plugin API over MCP tools.

## Core Tools (through this project)

- `launch_re_backend id=binary-ninja-mcp`
- `re_http_call id=binary-ninja-mcp path=/tool/decompile`

## When to Use

- Need Binja's HLIL / MLIR-style IR for analysis.
- Prefer Binja's platform support over Ghidra (Switch homebrew, DEX, Mach-O arm64e).
- Pair with Binja's own ILValue analysis for simplification passes.

## Related

Alternative to [[superghidra-mcp]] / [[ida-pro-mcp]]. Pairs with [[rea-reverse-engineer-anything]] for cross-tool orchestration.
