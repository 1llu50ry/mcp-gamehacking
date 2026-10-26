---
name: vmp-analyzer
description: VMProtect analysis helpers -- handler identification, devirtualization strategies.
type: tool-plugin
---

# Plugin: vmp-analyzer

VMProtect analysis helpers -- handler identification, devirtualization strategies.

## Detailed Specification

### Target Primitive
VMProtect analysis helpers -- handler identification, devirtualization strategies.

### Signature / Fingerprint
VMProtect VM entry, 32/64/128-bit handlers, mutation table, section '.vmp0'/'.vmp1'.

### Recovery Technique
VM devirt via Triton/Miasm, taint analysis of handler dispatch, static VTIL recovery (NoVmp, VTIL).

### Companion Tools
NoVmp, VMPAttack, Triton, LLVMemuli, VTIL.

### Query Interface
- `scan(binary)` -> candidate matches with VA + confidence
- `extract_key(binary, va)` -> raw key bytes with context
- `verify(key, sample)` -> round-trip encrypt/decrypt check
- `related_impls()` -> archive projects implementing the same primitive

### Related Skills
Combine with `anti-disassembly-techniques`, `control-flow-flattening`, and the specific algorithm skill in the hand-written library.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
