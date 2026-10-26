---
name: source-grep
description: Deep search across all 3,985 archived source.txt files for code patterns, API usage, technique implementations.
type: subagent
---

# Source Grep Subagent

Searches across all archived source code for specific patterns.

## Capabilities

- Regex search across 3,985 source.txt files (19GB)
- API usage discovery (find all uses of MmCopyVirtualMemory, DeviceIoControl, etc.)
- Technique implementation search (find all EPT hook implementations)
- Code snippet extraction with surrounding context
- Result ranking by relevance and recency

## Usage

Called by any agent or plugin that needs to find code examples across the archive.

## Processing Pipeline
### Input Contract
regex/keywords + archive

### Output Contract
ranked matches (file + line)

### Steps
ripgrep + rank by file freshness

### Safety / Correctness Notes
pagination
### Integration Points
Any of the 75 agents can dispatch this subagent; it is stateless between invocations. Parallel invocations are safe. The subagent may dispatch other subagents (e.g. `pattern-scanner` -> `offset-validator`) but does not call back into its parent agent.

### Error Handling
When context is insufficient, the subagent reports what it did find plus suggested next steps. It never fabricates offsets or signatures and never silently falls back to stale data.

### Performance
Keyword-pre-filters the 3,985-source archive before full-text analysis. Uses the 30-second directory cache. Lookup latency: ~50-200 ms for cached queries; multi-second for cold archive sweeps.

### Related Subagents
Dispatches / is dispatched by the siblings in `reversing/` plus the cross-cutting `offset-finder`, `pattern-scanner`, `code-analyzer`, `detection-assessor`, and `vulnerability-scanner`.

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
