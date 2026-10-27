# Value Proposition — Codebase Index

>

## One-Sentence Pitch

A persistent, local-only code knowledge graph embedded directly into local-memory-mcp that gives AI agents instant structural awareness of a TypeScript/JavaScript codebase — eliminating token-wasting file-by-file exploration and hallucinated symbols.

---

## vs. codebase-memory-mcp (DeusData)

| Dimension        | codebase-memory-mcp (C)                            | Codebase Index (local-memory-mcp)                                    |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| **Language**     | Pure C, compiled binary                            | TypeScript/Node.js (matches project stack)                           |
| **Storage**      | Separate SQLite at `~/.cache/codebase-memory-mcp/` | Shared SQLite inside local-memory-mcp's existing `memory.db`         |
| **Integration**  | Standalone MCP server, separate config             | First-class module of local-memory-mcp — one config entry            |
| **Languages**    | 158 languages (tree-sitter)                        | TypeScript/JavaScript only (MVP) — extendable via tree-sitter        |
| **Performance**  | 28M LOC / 3 min (C, RAM-first)                     | Slower (Node.js), but adequate for typical TS repos (<500K LOC)      |
| **LSP**          | Hybrid LSP (10 languages)                          | Phase 2 (LSP integration)                                            |
| **Distribution** | Static binary, npm, PyPI, Homebrew, etc.           | Ships with local-memory-mcp — `npm install @vheins/local-memory-mcp` |
| **Graph UI**     | Built-in 3D visualization (Go-based)               | Dashboard tab (Svelte 5) — consistent UX with existing dashboard     |
| **Cost**         | Free (MIT)                                         | Free (MIT) — no additional dependency                                |
| **License**      | MIT                                                | MIT                                                                  |

### Why NOT just use codebase-memory-mcp?

codebase-memory-mcp is impressive but is a **separate tool** with its own install, config, storage, and lifecycle. Users of local-memory-mcp would need to:

1. Install a separate binary (Go/C compiled)
2. Configure a second MCP server entry
3. Maintain two separate SQLite databases
4. Learn a different set of MCP tools
5. Duplicate agent memory between two systems

**Codebase Index removes all five friction points** by being a native module.

---

## Key Differentiators

### 1. TypeScript-Native, Shared Storage

The entire project is TypeScript, and the code graph lives in the **same SQLite database** as memories, tasks, and standards. Benefits:

- Single backup/restore point
- Cross-entity queries possible (e.g., "find memories related to functions in `order.ts`")
- No cross-process locking issues (already handled by `proper-lockfile`)
- Atomic consistency — code graph and memory are never out of sync

### 2. Local-First, Zero External Dependencies

Codebase Index adds tree-sitter WASM bindings as the only new dependency. Everything else (SQLite, Express, Svelte dashboard) already exists in local-memory-mcp. No Docker, no API keys, no separate daemon.

### 3. Unified Knowledge Graph

local-memory-mcp already has a knowledge graph (NLP-extracted entities from memory). The Codebase Index extends it with code-specific entities:

- `Function`, `Class`, `Method`, `Interface`, `Type`, `Variable` nodes
- `CALLS`, `IMPLEMENTS`, `EXTENDS`, `DEFINES` edges
- Shared graph visualization in the existing Dashboard

This means a memory about `OrderService` can link to the actual function node in the code graph — bridging project knowledge and source code.

### 4. Dashboard Integration

Instead of a standalone 3D graph UI (codebase-memory-mcp's approach), Codebase Index gets a **Dashboard tab** that sits alongside Memory, Tasks, and Activity Log tabs — giving users a single pane for all project intelligence.

### 5. Progressive Enhancement

> **Phasing NORMALIZED (2026-08-10):** the original "Phase 2 / Phase 3" labels below used a different numbering than the PRD/mvp-scope docs (PRD: MVP → Phase 1.1 → Phase 1.2 → Phase 2+). Per the DC-3 docs task (TASK-321), this section now uses the PRD numbering, with ship status annotated: **dead code detection = Phase 1.2 (C5) — IMPLEMENTED** (ARCHITECTURE-mode `deadCode` block, TASK-319); **LSP integration + type inference = Phase 2+ (W2)** — still NEXT PHASE; dashboard graph visualization = Phase 1.2 (C2) — NOT shipped (NEXT PHASE).

The index is built incrementally:

- **MVP (Phase 1.0)**: File discovery + tree-sitter parsing + symbol storage + basic search
- **Phase 1.1**: Call-site + heritage reference edges (call/instantiation/import since v21; extends/implements since v23) — name-based per ADR-002
- **Phase 1.2**: Dead code detection (**IMPLEMENTED**, ARCHITECTURE `deadCode` block); dashboard graph visualization (NOT shipped)
- **Phase 2+**: LSP integration, type inference, cross-service linking (NEXT PHASE)

Users get value from day 1 without configuring anything beyond what local-memory-mcp already requires.

---

## Value to the Project (local-memory-mcp)

| Benefit                    | Impact                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| **Market differentiation** | No other local MCP memory server includes built-in code indexing                              |
| **Ecosystem lock-in**      | Once an agent relies on the code index, switching to a separate tool loses that capability    |
| **Token economics**        | Dramatically reduces token consumption for agent repos using local-memory-mcp                 |
| **Completeness**           | local-memory-mcp becomes a full-stack project intelligence platform (memories + tasks + code) |
| **Adoption driver**        | Code indexing is the #1 requested feature for MCP memory servers                              |

---

## Quantified Value (Estimated)

| Metric                            | Without Index      | With Index         | Improvement         |
| --------------------------------- | ------------------ | ------------------ | ------------------- |
| Tokens per code query             | ~82K (grep+read)   | ~700 (graph query) | **99.1% reduction** |
| Agent accuracy (symbol names)     | ~70% (guessed)     | ~100% (resolved)   | **+30%**            |
| Time to understand new module     | 15-30 min (tokens) | 30-60 sec          | **~20x faster**     |
| Cross-file change impact (manual) | 5-10 min           | 5-10 sec           | **~60x faster**     |
