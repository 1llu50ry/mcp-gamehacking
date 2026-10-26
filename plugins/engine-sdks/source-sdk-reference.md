---
name: source-sdk-reference
description: Source engine SDK reference -- CBaseEntity, IClientEntityList, ConVar, NetVar tables.
type: tool-plugin
---

# Plugin: source-sdk-reference

Source engine SDK reference -- CBaseEntity, IClientEntityList, ConVar, NetVar tables.

## Detailed Specification

### Target Engine
Source 1 (CS:GO, L4D2, TF2)

### Key Classes / Globals
CBaseEntity, IClientEntityList, IVEngineClient, IPanel, CGlobalVarsBase, CUserCmd, ConVar, NetVar via ClientClass

### Core API Surface
GetClientEntity, GetScreenSize, GetViewAngles, GetHandleEntity; recv_props NetVar hashing.

### Field Offsets
m_iHealth, m_vecOrigin, m_fFlags, m_hOwnerEntity, m_dwBoneMatrix.

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
