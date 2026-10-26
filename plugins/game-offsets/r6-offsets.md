---
name: r6-offsets
description: Rainbow Six Siege offset database -- entity manager, operator, outline, camera.
type: tool-plugin
---

# Plugin: r6-offsets

Rainbow Six Siege offset database -- entity manager, operator, outline, camera.

## Detailed Specification

### Target Title
Rainbow Six Siege

### Key Offsets
BoneBase, PlayerManager, LocalPlayer, Entity->Health, Entity->BoneMatrix, ViewMatrix (D3D CB)

### Schema / Reflection
proprietary Scimitar engine; BattlEye kernel; mapped by community (CheatHouse, UC).

### Update Cadence
operation Y11+, offsets rotate; Vulkan backend forces different render hooks.

### Weapon / Combat Fields
WeaponHandler, AmmoCount, Primary/Secondary.

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
