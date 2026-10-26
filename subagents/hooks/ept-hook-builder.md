---
name: ept-hook-builder
description: Build EPT hooks with split-page execution and read/write transparency.
type: subagent
---

# Subagent: ept-hook-builder

Build EPT hooks with split-page execution and read/write transparency.

## Processing Pipeline
### Input Contract
guest VA, host code page, violation handler

### Output Contract
EPT entry split 4K; read-shadow vs exec-shadow; MTF stepping handler

### Steps
setup EPT PML4; set target page RWX bits; register violation handler

### Safety / Correctness Notes
requires custom HV (Hyperplatform/bareflank/ddimon)
### Integration Points
Any of the 75 agents can dispatch this subagent; it is stateless between invocations. Parallel invocations are safe. The subagent may dispatch other subagents (e.g. `pattern-scanner` -> `offset-validator`) but does not call back into its parent agent.

### Error Handling
When context is insufficient, the subagent reports what it did find plus suggested next steps. It never fabricates offsets or signatures and never silently falls back to stale data.

### Performance
Keyword-pre-filters the 3,985-source archive before full-text analysis. Uses the 30-second directory cache. Lookup latency: ~50-200 ms for cached queries; multi-second for cold archive sweeps.

### Related Subagents
Dispatches / is dispatched by the siblings in `hooks/` plus the cross-cutting `offset-finder`, `pattern-scanner`, `code-analyzer`, `detection-assessor`, and `vulnerability-scanner`.

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
