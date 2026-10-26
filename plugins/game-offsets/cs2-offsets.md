---
name: cs2-offsets
description: Counter-Strike 2 offset database -- entity list, bone matrix, NetVars, weapon data, view matrix.
type: tool-plugin
---

# Plugin: cs2-offsets

Counter-Strike 2 offset database -- entity list, bone matrix, NetVars, weapon data, view matrix.

## Detailed Specification

### Target Title
Counter-Strike 2 / Source 2

### Key Offsets
dwEntityList, dwLocalPlayerPawn, dwViewMatrix, dwPlantedC4, pawn.m_iHealth / m_lifeState / m_hPlayerPawn, controller.m_sSanitizedPlayerName

### Schema / Reflection
Source 2 schema system (dumped via SchemaSystem), bone matrix via CGameSceneNode -> CSkeletonInstance.

### Update Cadence
updated weekly during active season; offset dumps on github.com/a2x/cs2-dumper.

### Weapon / Combat Fields
weapon_services.m_hActiveWeapon, m_iClip1, m_iItemDefinitionIndex.

### Query Interface
- `get_offset(name, version?)` -> `{va, source_url, confidence_tier, build}`
- `list_versions()` -> builds known to the DB
- `diff_versions(a, b)` -> adds/removes/shifts
- `last_known_good()` -> most-recently validated build

### Related Agents and Subagents
`offset-finder`, `offset-migrator`, `offset-auto-updater`, `offset-validator`, `offset-confidence-scorer`, plus the per-game specialist agent.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
