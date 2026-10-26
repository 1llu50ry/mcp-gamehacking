---
name: pattern-scanner
description: Generate and validate byte patterns (signatures) for game functions and data structures.
model: sonnet
tools: [read_skill, read_source, search_skills]
---

# Pattern Scanner Subagent

Generates IDA-style byte patterns from code, validates patterns across versions, and resolves RIP-relative addresses.

## Task

Given a function name or code region:
1. Search archived sources for existing patterns
2. Generate new patterns from disassembly if provided
3. Validate uniqueness (no false positives)
4. Calculate RIP-relative resolution offsets

## Pattern Format

```
// IDA-style: known bytes + ?? wildcards
"48 8B 05 ?? ?? ?? ?? 48 85 C0 74 ??"

// With resolution info:
Pattern: "48 8D 05 ?? ?? ?? ?? 48 85 C0"
RIP offset: 3  (displacement starts at byte 3)
Resolution: addr + 3 + 4 + int32_at(addr+3) = target
```

## Common Patterns (UE games)

- GWorld: `48 8D 05 ?? ?? ?? ?? 48 85 C0` (rip_off=3)
- GObjects: `48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? 48` (rip_off=3)
- FNamePool: `48 8D 1D ?? ?? ?? ?? 41 B8` (rip_off=3)
- ProcessEvent: LEA + indirect call pattern

## Processing Pipeline
### Input Contract
pattern string + binary

### Output Contract
match address

### Steps
AVX scanner

### Safety / Correctness Notes
uniqueness check
### Integration Points
Any of the 75 agents can dispatch this subagent; it is stateless between invocations. Parallel invocations are safe. The subagent may dispatch other subagents (e.g. `pattern-scanner` -> `offset-validator`) but does not call back into its parent agent.

### Error Handling
When context is insufficient, the subagent reports what it did find plus suggested next steps. It never fabricates offsets or signatures and never silently falls back to stale data.

### Performance
Keyword-pre-filters the 3,985-source archive before full-text analysis. Uses the 30-second directory cache. Lookup latency: ~50-200 ms for cached queries; multi-second for cold archive sweeps.

### Related Subagents
Dispatches / is dispatched by the siblings in `patterns/` plus the cross-cutting `offset-finder`, `pattern-scanner`, `code-analyzer`, `detection-assessor`, and `vulnerability-scanner`.

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
