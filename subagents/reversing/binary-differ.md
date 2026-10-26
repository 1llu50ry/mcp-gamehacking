---
name: binary-differ
description: Diff game updates to track offset changes, find new functions, and detect struct layout shifts between versions.
type: subagent
---

# Binary Differ Subagent

Compares game binary versions to track changes.

## Capabilities

- Function-level diffing (bindiff-style matching)
- Offset migration: map old offsets to new binary
- Struct layout change detection (size changes, field reordering)
- New function discovery and classification
- Pattern breakage detection (which byte patterns still match)
- Changelog generation for offset tables

## Usage

Called by `offset-finder` or `cheat-developer` after a game update.

## Processing Pipeline
### Input Contract
two binary builds

### Output Contract
function match + offset shifts + new/removed symbols

### Steps
BinDiff/Diaphora/Dyninst; function hash + CFG match

### Safety / Correctness Notes
report confidence per match
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
