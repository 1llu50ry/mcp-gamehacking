---
name: struct-recovery
description: Recover C/C++ structures from memory dumps, IDA databases, or runtime data using cross-referencing and heuristics.
type: subagent
---

# Struct Recovery Subagent

Reconstructs C/C++ structures from raw memory or disassembly.

## Capabilities

- Field type inference from access patterns (mov sizes, lea offsets)
- RTTI parsing for C++ class hierarchies
- VTable reconstruction and virtual method mapping
- UE4/UE5 UObject/UStruct reflection data parsing
- Cross-reference with known SDK dumps in skill library
- Output: C struct/class definition with field names and offsets

## Usage

Called by `reverse-engineer` or `cheat-developer` agents when struct layouts are needed.

## Processing Pipeline
### Input Contract
memory dump or IDA db

### Output Contract
C++ struct with field types + sizes

### Steps
cluster accesses by base register + offset; infer type from access width + usage

### Safety / Correctness Notes
static_assert sizeof check
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
