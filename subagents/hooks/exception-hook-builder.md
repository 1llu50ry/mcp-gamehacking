---
name: exception-hook-builder
description: Build exception-based hooks using INT3, page guard, or debug registers.
type: subagent
---

# Subagent: exception-hook-builder

Build exception-based hooks using INT3, page guard, or debug registers.

## Processing Pipeline
### Input Contract
target instruction address, hook replacement

### Output Contract
VEH handler + INT3 or page-guard trigger

### Steps
AddVectoredExceptionHandler; patch target to INT3 or make page PAGE_GUARD; handler forwards + continues

### Safety / Correctness Notes
needs DebugFlag/CFG consideration
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
