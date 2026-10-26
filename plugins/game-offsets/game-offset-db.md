---
name: game-offset-db
description: Cross-reference game offsets across all archived projects. Find, validate, and track offset changes between versions.
type: tool-plugin
---

# Game Offset Database Plugin

Searches the full skill library (3900+ projects) to build cross-referenced offset tables for any supported game.

## Commands

### `offset_lookup`
Find a specific offset across all archived sources.
- Input: game name, offset name (e.g., "cs2", "local_player")
- Output: all matching values, source count, confidence

### `offset_table`
Build a complete offset table for a game.
- Input: game name
- Output: all known offsets with values and sources

### `offset_diff`
Compare offsets between two project versions.
- Input: two skill names
- Output: changed offsets with old/new values

## Supported Games (by archive count)

Games with 5+ archived projects: CS2, CSGO, Valorant, Fortnite, Apex Legends,
PUBG, Rust, R6 Siege, EFT, Overwatch, DayZ, Genshin Impact, Minecraft,
Call of Duty (Warzone/MW/BO), Battlefield, Roblox, GTA V, League of Legends,
Dota 2, MapleStory, PalWorld, Arma 3, Elden Ring, Sea of Thieves

## Detailed Specification

### Target Title
cross-game aggregator (60+ titles)

### Key Offsets
entity list / local player / view matrix / bone matrix / weapon list / crosshair -- normalized across engines

### Schema / Reflection
stored as JSON per game with versions, SHA256 of binary, extraction timestamp, source URL.

### Update Cadence
per-game timeline; last-known-good anchor + diff on new builds.

### Weapon / Combat Fields
weapon class -> ammo path per game.

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
