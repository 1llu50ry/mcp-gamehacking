---
name: vmt-hook-builder
description: Build VMT hooks with shadow copy, index resolution, and automatic cleanup.
type: subagent
---

# Subagent: vmt-hook-builder

Build VMT hooks with shadow copy, index resolution, and automatic cleanup.

## Processing Pipeline
### Input Contract
object pointer, vtable slot, replacement

### Output Contract
slot replaced; original stored for forward

### Steps
read object*[0]=vtable; VirtualProtect vtable; swap slot[N]

### Safety / Correctness Notes
per-object vs per-class patching; thread-safety
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
