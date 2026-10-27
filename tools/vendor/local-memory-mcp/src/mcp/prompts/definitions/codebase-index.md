---
name: codebase-index
description: Priority-ordered guidance for codebase index MCP tools (search_symbols, codebase_search, trace_symbol, get_architecture) before falling back to explore sub-agent.
arguments: []
agent: System Architect
---

## Codebase Index Priority

Use MCP codebase index tools in this order:

1. **Codebase Index MCP Tools** (local-memory-mcp):
   - `search_symbols(query, kind?, owner, repo?, filePath?, exportedOnly?)` — find symbols by name with 5-tier ranking
   - `codebase_search(query, owner, repo?, kind?, filePath?)` — natural language FTS5 search across codebase
   - `trace_symbol(name, owner, repo?, includeReferences?)` — definition + cross-file usage. Returns start_line, end_line.
   - `get_architecture(owner, repo, depth?, includeSymbolCounts?)` — directory tree, language breakdown
   - `get_file_symbols(owner, repo, filePath)` — all symbols in a file. Returns start_line, end_line.
   - `index_status(owner, repo, repoPath?)` — check index health + staleness
   - `index_repository(owner, repo, repoPath)` — trigger indexing

   **`search_symbols` vs `codebase_search`**: Use `search_symbols` when you know (part of) the symbol name. Use `codebase_search` for natural language queries like "find the function that handles authentication tokens".

2. **explore sub-agent** (fallback): regex content search, non-indexed languages, filesystem inspection beyond get_architecture.

3. **Direct read/glob** (last resort): trivial lookups when path is already known.

Flow: `index_status` → if not indexed/stale → `index_repository` → search/trace.

For detailed FSM execution, load the `codebase-index` skill.
