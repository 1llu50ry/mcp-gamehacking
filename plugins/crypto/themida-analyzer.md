---
name: themida-analyzer
description: Themida/WinLicense analysis -- unpacking strategies, VM handler mapping.
type: tool-plugin
---

# Plugin: themida-analyzer

Themida/WinLicense analysis -- unpacking strategies, VM handler mapping.

## Detailed Specification

### Target Primitive
Themida/WinLicense analysis -- unpacking strategies, VM handler mapping.

### Signature / Fingerprint
Themida VM entry trampoline, mutated prologue, PE sections '.themida' or similar; VM dispatcher pattern (fetch -> decode -> dispatch).

### Recovery Technique
trace handlers via Scylla+Themida unpacker, custom VM lifter (Oreans Code Virtualizer, FishHunter).

### Companion Tools
ThemidaDie, unlicense, SigMakerEx, Pint.

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
