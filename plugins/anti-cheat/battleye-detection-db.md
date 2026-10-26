---
name: battleye-detection-db
description: BattlEye detection method database -- driver scans, memory checks, heartbeat, shellcode patterns.
type: tool-plugin
---

# Plugin: battleye-detection-db

BattlEye detection method database -- driver scans, memory checks, heartbeat, shellcode patterns.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** BEDaisy.sys / BEService.exe
- **Operating mode:** kernel + user shellcode streamed from BE server

### Detection Surface
PspCidTable walk, VEH enumeration, Present-pointer integrity, system-thread origin, module CRC, prologue-hook detection.

### Version Timeline
launcher-side bootstrapping varies per title (PUBG, R6S, DayZ, Arma); recent builds pull scanning modules at runtime.

### Bypass Windows
runtime shellcode intercept, manually-mapped-driver thread hiding, present-hook stealth, VEH guard.

### Related Skills and Projects
Linked skills: `battleye`, `be-shellcode`, `battleye-shellcode-dumper`, `be-shellcode-tester`, `battleye-region-walking`, `r6s-external-v2`.

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
