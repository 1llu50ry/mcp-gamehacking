---
name: cheat-engine-finder
description: Find Cheat Engine scripts and tables in the archived source library.
type: tool-plugin
---

# Plugin: cheat-engine-finder

Find Cheat Engine scripts and tables in the archived source library.

## Detailed Specification

### Ecosystem
Cheat Engine (CE) .CT tables, Lua scripts, DBVM

### Query Model
search by game/version/author for existing CT tables.

### Entry Fields
AOB signatures, pointer paths, Lua auto-attach.

### Notable Sources
ce-sharelist, FearlessRevolution, github:cheat-engine-tables.

### Query Interface
- `search(query, filter?)` -> ranked results
- `by_game(name)` -> all tooling for that title
- `by_author(name)` -> author's catalogue
- `freshness(id)` -> last-updated timestamp

### Related Prompts
`find-bypass`, `analyze-cheat`, and the per-tool specialist agent.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
