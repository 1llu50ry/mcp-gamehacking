---
name: ue5-sdk-reference
description: Unreal Engine 5 SDK structure reference -- double FVector, large world coords, Nanite, Lumen.
type: tool-plugin
---

# Plugin: ue5-sdk-reference

Unreal Engine 5 SDK structure reference -- double FVector, large world coords, Nanite, Lumen.

## Detailed Specification

### Target Engine
Unreal Engine 5 (5.0 - 5.4)

### Key Classes / Globals
FUObjectArray with ChunkedTUObjectArray, FNamePool (block/chunk hashed), WorldPartition, UGameInstance, Nanite/Lumen components

### Core API Surface
ProcessEvent with slot-based obfuscation in some builds; VerseVM in Fortnite.

### Field Offsets
FName offsets shifted (ComparisonIndex is 32-bit index now), Chunks[] instead of linear table.

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
