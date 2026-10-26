---
name: aes-key-finder
description: Find AES keys in process memory via key schedule detection.
type: tool-plugin
---

# Plugin: aes-key-finder

Find AES keys in process memory via key schedule detection.

## Detailed Specification

### Target Primitive
Find AES keys in process memory via key schedule detection.

### Signature / Fingerprint
T-table constants (0x63635263, 0xC66363A5...), S-box (0x637C777B...), key schedule (Rijndael round constants 0x01, 0x02, 0x04, 0x08, 0x10, 0x20...).

### Recovery Technique
signature scan for S-box in .rdata; backtrack to KeyExpansion; carve 16/24/32 B key from stack or thread context on breakpoint.

### Companion Tools
findaes, CryptoDeTeck, aeskeyfind, VolDiff, custom YARA.

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
