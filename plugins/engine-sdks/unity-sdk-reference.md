---
name: unity-sdk-reference
description: Unity IL2CPP/Mono SDK reference -- Il2CppClass, MethodInfo, GameObjectManager.
type: tool-plugin
---

# Plugin: unity-sdk-reference

Unity IL2CPP/Mono SDK reference -- Il2CppClass, MethodInfo, GameObjectManager.

## Detailed Specification

### Target Engine
(see description)

### Key Classes / Globals
(see parent skill for the full class list)

### Core API Surface
runtime APIs commonly hooked by cheats.

### Field Offsets
maintained per engine version; see `offset-finder` for cross-build lookup.

### Query Interface
- `class(name)` -> metadata, parents, VTable, fields
- `field(class, name)` -> type + offset
- `vtable(class)` -> ordered slot list
- `find_by_signature(pattern)` -> class match from binary
- `generate_header(class, version)` -> C++ header via `sdk-header-generator`

### Related Code Generators
`sdk-header-generator`, `offset-header-generator`, `vtable-header-generator`, `enum-generator`.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
