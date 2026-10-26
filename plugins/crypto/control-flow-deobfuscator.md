---
name: control-flow-deobfuscator
description: Control flow deobfuscation -- deflattening, bogus predicate removal, MBA simplification.
type: tool-plugin
---

# Plugin: control-flow-deobfuscator

Control flow deobfuscation -- deflattening, bogus predicate removal, MBA simplification.

## Detailed Specification

### Target Primitive
Control flow deobfuscation -- deflattening, bogus predicate removal, MBA simplification.

### Signature / Fingerprint
flattened CFG (dispatcher + state var), opaque predicates, bogus branches.

### Recovery Technique
dispatcher ID, SMT-driven path reconstruction, VTIL IR lifting, Themida/VMP devirt.

### Companion Tools
VTIL, Dagger, Souper, OLLVM-deobfuscator, miasm symbolic exec.

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
