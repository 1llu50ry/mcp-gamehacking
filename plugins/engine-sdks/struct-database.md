---
name: struct-database
description: Known game engine structures across versions -- UE4/UE5, Source, Unity IL2CPP field layouts and offsets.
type: tool-plugin
---

# Struct Database Plugin

Cross-referenced database of game engine structures from archived sources.

## Commands

### `struct_lookup`
Find a known structure definition.
- Input: struct name (e.g., "FVector", "APlayerController", "CBaseEntity", "Il2CppClass")
- Output: field layout with offsets, size, engine version

### `struct_diff`
Compare a structure between engine versions.
- Input: struct name, version A, version B
- Output: field changes, size delta, offset shifts

### `struct_search`
Find structures containing a specific field or offset.
- Input: field name or offset value
- Output: matching structures with context

## Engines Covered

- **Unreal Engine**: UE4.x, UE5.x (UObject, AActor, ACharacter, USkeletalMesh, etc.)
- **Source Engine**: Source 1, Source 2 (CBaseEntity, C_BasePlayer, IClientEntity, etc.)
- **Unity**: Mono, IL2CPP (Il2CppClass, Il2CppObject, MethodInfo, etc.)
- **id Tech**: entity systems, BSP structures

## Detailed Specification

### Target Engine
cross-engine aggregator

### Key Classes / Globals
UE4/UE5 UObject hierarchy, Source CBaseEntity, Unity GameObject/Transform/Component, IL2CPP MetaData types

### Core API Surface
indexed by engine + version + struct name.

### Field Offsets
normalized field names across versions; migration deltas annotated.

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
