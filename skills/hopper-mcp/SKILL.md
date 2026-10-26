---
name: hopper-mcp
description: "Hopper MCP -- bridge over Hopper's Python scripting runtime. Primary disassembler for macOS / iOS game work on ARM / Mach-O. Decompiler + pseudocode. Agent-callable xref, decomp, segment inspection."
metadata:
  type: tool-reference
  source: external/hopper
  topics: [hopper, mcp, static, mach-o, ios, macos, arm, decompile]
---

# Hopper MCP

MCP bridge for Hopper Disassembler (v4/v5). Agent drives Hopper's Python API for Mach-O / ARM / iOS binaries.

## Operating Model

- Hopper owns the project (`.hop` file).
- `hopper-mcp` runs inside Hopper's Python runtime.
- Exposes decompile, xrefs, segments, procedures, strings, labels.

## Core Tools (through this project)

- `launch_re_backend id=hopper-mcp`
- `re_http_call id=hopper-mcp path=/tool/decompile`

## When to Use

- iOS / macOS / tvOS game binary.
- Mach-O arm64e (pointer-authentication) targets.
- You want Hopper's pseudocode quality over Ghidra's.

## Related

Alternative to [[superghidra-mcp]] / [[ida-pro-mcp]] on Apple platforms. REA ([[rea-reverse-engineer-anything]]) can dispatch to Hopper automatically.
