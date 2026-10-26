---
name: import-resolver
description: Resolve imports for manual-mapped or injected modules -- build IAT, forward exports, handle delayed imports and API sets.
type: subagent
---

# Import Resolver Subagent

Handles import resolution for injected/mapped modules.

## Capabilities

- IAT reconstruction for manual-mapped PEs
- API set resolution (api-ms-win-* -> real DLL)
- Export forwarding chain resolution
- Delayed import handling
- Syscall stub generation (direct/indirect)
- MinWin layer mapping

## Usage

Called by `exploit-developer` or `driver-developer` when building injection or mapping tools.

## Processing Pipeline
### Input Contract
shellcode or manual-mapped PE

### Output Contract
resolved function pointers

### Steps
walk PEB loader; hash API names (fnv/ror13); fill IAT

### Safety / Correctness Notes
fallback LoadLibrary for missing modules
### Integration Points
Any of the 75 agents can dispatch this subagent; it is stateless between invocations. Parallel invocations are safe. The subagent may dispatch other subagents (e.g. `pattern-scanner` -> `offset-validator`) but does not call back into its parent agent.

### Error Handling
When context is insufficient, the subagent reports what it did find plus suggested next steps. It never fabricates offsets or signatures and never silently falls back to stale data.

### Performance
Keyword-pre-filters the 3,985-source archive before full-text analysis. Uses the 30-second directory cache. Lookup latency: ~50-200 ms for cached queries; multi-second for cold archive sweeps.

### Related Subagents
Dispatches / is dispatched by the siblings in `injection/` plus the cross-cutting `offset-finder`, `pattern-scanner`, `code-analyzer`, `detection-assessor`, and `vulnerability-scanner`.

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
