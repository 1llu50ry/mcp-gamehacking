---
name: etw-hook-builder
description: Build ETW provider hooks for telemetry interception and patching.
type: subagent
---

# Subagent: etw-hook-builder

Build ETW provider hooks for telemetry interception and patching.

## Processing Pipeline
### Input Contract
ETW provider GUID, event filter

### Output Contract
patched EtwRegister or inline hook on EtwEventWrite

### Steps
find EtwThreatIntProvRegHandle; patch provider ptr or NOP EtwEventWrite body

### Safety / Correctness Notes
Microsoft-Windows-Threat-Intelligence suppression noisy
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
