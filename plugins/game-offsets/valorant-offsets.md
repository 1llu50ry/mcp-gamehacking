---
name: valorant-offsets
description: Valorant offset database -- GWorld, GObjects, PlayerArray, Mesh, DamageHandler, all vgc:: offsets.
type: tool-plugin
---

# Plugin: valorant-offsets

Valorant offset database -- GWorld, GObjects, PlayerArray, Mesh, DamageHandler, all vgc:: offsets.

## Detailed Specification

### Target Title
Valorant (modified UE4)

### Key Offsets
UWorld, GNames, GObjects, ULocalPlayer, APlayerController, Mesh->BoneArray, APawn->MovementComponent

### Schema / Reflection
UE4 reflection, but TUPS obfuscates; Vanguard prevents easy dumping.

### Update Cadence
episode/act updates; XOR'd GNames/GObjects pointer each patch.

### Weapon / Combat Fields
WeaponInstance->CurrentAmmo, WeaponManager->EquippedWeapon.

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
