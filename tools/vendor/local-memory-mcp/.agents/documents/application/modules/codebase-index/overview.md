# Codebase Index Module

> Tree-sitter WASM index → 5-mode read. Tables: `codebase_files`, `codebase_symbols`, `codebase_references`, `codebase_symbols_fts` (all in `memory.db`).

## Parse

15 visitors (14 grammars via `web-tree-sitter` WASM + Markdown) + generic fallback — TS/TSX/Svelte/Astro share TS visitor; Vue has dedicated visitor. Languages: TypeScript, JavaScript, Vue, Go, Python, PHP, Rust, Java, Dart, Kotlin, Ruby, Swift, C, C++, Markdown. Build: `bash scripts/copy-grammar-wasm.sh` → `dist/grammars/*.wasm`.

## Tools (2)

| Tool             | Mode (auto-infer)                                                                           | File                              |
| :--------------- | :------------------------------------------------------------------------------------------ | :-------------------------------- |
| `codebase-index` | `repoPath+repo`→INDEX · `repo` only→STATUS                                                  | `src/mcp/tools/codebase-index.ts` |
| `codebase-read`  | `name`→TRACE · `filePath`→FILE · `content`→CODE (grep) · `query`→SEARCH · none→ARCHITECTURE | `src/mcp/tools/codebase.read.ts`  |

SEARCH tiers: exact → camelCase → prefix → substring → FTS5. Auto-index: `CODEBASE_AUTO_INDEX` (24h TTL). See [API: codebase-index](../../api/codebase-index/api-codebase.md), [operations guide](./runbook.md), [architecture](./specs/design-architecture.md), [ADR-002](../../../design/decisions/adr-002-codebase-index.md).
