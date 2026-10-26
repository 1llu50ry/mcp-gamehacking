---
name: byfron-detection-db
description: Byfron/Hyperion (Roblox) detection database -- Luau exploit detection, module integrity.
type: tool-plugin
---

# Plugin: byfron-detection-db

Byfron/Hyperion (Roblox) detection database -- Luau exploit detection, module integrity.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** no kernel driver -- usermode VM protection
- **Operating mode:** Roblox-only; Hyperion loader + Byfron VM + runtime JIT

### Detection Surface
virtualized integrity checks, syscall monitoring, memory tagging, hypervisor detection, HWID.

### Version Timeline
Hyperion rolled out 2023+; frequent VM mutations and anti-dumping updates.

### Bypass Windows
VM devirtualization, syscall emulation, Linux Wine + patched Hyperion.

### Related Skills and Projects
Linked skills: `roblox-researcher`, `byfron`.

### Data Model
Each entry is `(detection_vector, driver_component, OS build range, countermeasure, references[])`. Vectors are tagged `kernel|usermode|telemetry|behavioural|hardware`. Countermeasures carry a `shelf_life` field annotated against the `anti-cheat-timeline` plugin.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
