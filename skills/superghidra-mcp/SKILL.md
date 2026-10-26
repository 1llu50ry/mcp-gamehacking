---
name: superghidra-mcp
description: "SuperghidraMCP -- 38-tool MCP server that fronts SuperGhidra and pyghidra-mcp for AI agents (Claude Code, Antigravity, Cursor, Codex). Private per-session project forks, persistent lock-free daemon cache, GPU AArch64 sweeps, Z3 SMT equivalence, MSVC/MFC C++ recovery, semantic code search over decompiled functions via ChromaDB vectors."
metadata:
  type: tool-reference
  source: better-options/SuperghidraMCP-main
  topics: [mcp, ghidra, pyghidra, agents, chromadb, semantic-search, class-recovery]
---

# SuperghidraMCP

Official MCP server for [[superghidra]], built on `pyghidra-mcp`. Exposes 38 tools to AI agents through the Model Context Protocol with session isolation and a lock-free daemon cache. Also runs in GUI-attached mode (`--gui`) sharing live program state with the Ghidra CodeBrowser.

## Why not plain GhidraMCP

- **Headless-first, GUI-capable.** Headless CLI for automation; `--gui` when a human reviews changes.
- **Project-wide analysis.** Reverse-engineer every binary in a Ghidra project concurrently.
- **Semantic code search.** ChromaDB vector embeddings over decompiled functions, comments, and symbols -- fuzzy pseudo-C lookup instead of exact substring match.
- **Async startup.** Server begins answering requests while binaries are still being analyzed.
- **Private forks.** Per-session project forks sit on the lock-free daemon cache; commits gate on validation and overlay sync.
- **CI/CD friendly.** Full unit + integration tests for client and server.

## Transport

- `streamable-http` -- recommended for agents and the companion `pyghidra-mcp-cli`.
- `stdio` -- local fallback for single-process agents.

## Flow

```
Agent (Claude Code / Cursor / Codex)
  -> streamable HTTP
     -> pyghidra-mcp (MCP tools)
        -> PyGhidra context
           -> Ghidra project (.gpr / .rep) [read-only]
           -> MCP artifacts (ChromaDB + GZF cache) [read-write]
           -> Ghidra GUI [only with --gui]
```

## When to Use

- Agent-driven reverse engineering where [[superghidra]] alone would need manual CLI invocations.
- Multi-binary projects (an engine + its DLLs, a driver + its usermode service): the server handles them concurrently.
- Need semantic search -- `ChromaDB` lets an agent search "function that decrypts settings" without knowing the exact string.
- Need to let a human in Ghidra GUI and an agent collaborate on the same project (`--gui` mode).

## Related

Pairs with [[superghidra]] for its underlying engine, [[ida-pro-mcp]] for the IDA equivalent, [[rea-reverse-engineer-anything]] for a cross-tool orchestration layer, and [[x64dbg-mcp-server]] for dynamic analysis. Preferred by the `ghidra-specialist` agent and the `reverse-engineer` agent.
