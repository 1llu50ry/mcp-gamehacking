---
name: cryengine-sdk-reference
description: CryEngine SDK reference -- IEntity, IGameFramework, gEnv, SSystemGlobalEnvironment.
type: tool-plugin
---

# Plugin: cryengine-sdk-reference

CryEngine SDK reference -- IEntity, IGameFramework, gEnv, SSystemGlobalEnvironment.

## Detailed Specification

### Target Engine
CryEngine 3/5 (Hunt: Showdown, Star Citizen, Prey)

### Key Classes / Globals
IEntity, IEntitySystem, IGameFramework, gEnv (SSystemGlobalEnvironment), IActor, IActorSystem, IPhysicalEntity

### Core API Surface
gEnv->pEntitySystem->GetEntity(id), IActorSystem::GetActor, QueryPhysicalEntitiesInBox.

### Field Offsets
position offset in SEntityDesc, pPhysicalEntity in IEntity.

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
