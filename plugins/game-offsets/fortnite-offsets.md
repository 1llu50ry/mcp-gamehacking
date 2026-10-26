---
name: fortnite-offsets
description: Fortnite offset database -- UWorld, GameInstance, PlayerPawn, BuildingActor, weapon offsets.
type: tool-plugin
---

# Plugin: fortnite-offsets

Fortnite offset database -- UWorld, GameInstance, PlayerPawn, BuildingActor, weapon offsets.

## Detailed Specification

### Target Title
Fortnite (UE5 with EAC/BE)

### Key Offsets
UWorld, GameState, LocalPlayer, PlayerPawn->Mesh->BoneArray, Pawn->CurrentWeapon

### Schema / Reflection
UE5 reflection obfuscated; GNames/GObjects XOR encoding; relevant offsets dumped via internal dumpers.

### Update Cadence
chapter/season/update cadence; EAC detection surface narrows per patch.

### Weapon / Combat Fields
ACurrentWeapon->BaseDamage, FireMode, MagazineAmmo.

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
