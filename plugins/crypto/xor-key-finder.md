---
name: xor-key-finder
description: Find XOR encryption keys from known plaintext or frequency analysis.
type: tool-plugin
---

# Plugin: xor-key-finder

Find XOR encryption keys from known plaintext or frequency analysis.

## Detailed Specification

### Target Primitive
Find XOR encryption keys from known plaintext or frequency analysis.

### Signature / Fingerprint
repeating XOR in loop body (xor BYTE PTR [reg+idx], key).

### Recovery Technique
known-plaintext (PE header, strings, zeroed region) XOR against candidate ciphertext; FFT-based key length detect.

### Companion Tools
xortool, GPT4-vision for visual repetition detection, custom hex analysis.

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
