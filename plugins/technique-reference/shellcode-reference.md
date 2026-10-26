---
name: shellcode-reference
description: Shellcode templates, encoders, and stagers reference.
type: tool-plugin
---

# Plugin: shellcode-reference

Shellcode templates, encoders, and stagers reference.

## Detailed Specification

### Technique Classification
position-independent, API-hash resolution, egg-hunter, encoder (XOR/SGN), reflective loader

### Detection Side-Channels
RWX page detect, loader signature.

### Mitigations and Hardening
CFG indirect call, CET-SS, ACG.

### Reference Implementations
msfvenom encoders, Shellcode-Loader-Rust, Donut.

### Query Interface
- `list_variants()` -> sub-techniques
- `find_implementations(language?)` -> archive matches
- `detection_vectors()` -> known detection logic per AC
- `platform_requirements()` -> OS build, HVCI/CFG state, driver signing

### Combined Workflow
Pipe into `exploit-chain-builder`, `hook-planner`, or `injection-planner` subagents to compose a complete chain.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
