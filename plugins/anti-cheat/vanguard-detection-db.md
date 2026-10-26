---
name: vanguard-detection-db
description: Riot Vanguard detection database -- kernel callbacks, HWID collection, boot-time checks.
type: tool-plugin
---

# Plugin: vanguard-detection-db

Riot Vanguard detection database -- kernel callbacks, HWID collection, boot-time checks.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** vgk.sys (boot-start) + vgc.exe (service)
- **Operating mode:** early-launch kernel driver + TPM/HVCI integration + usermode agent

### Detection Surface
driver blocklist, Secure Boot/HVCI check, test-signing check, hypervisor presence, periodic snapshots.

### Version Timeline
Riot Vanguard 1.x (Valorant, LoL); 2024+ enforces TPM 2.0 + Secure Boot on Windows 11.

### Bypass Windows
custom hypervisor (EPT hooks), BYOVD + manual map in early boot, HVCI-compatible drivers.

### Related Skills and Projects
Linked skills: `vanguard`, `valorant-specialist`, `vgk-reversing`, `hypervisor-researcher`.

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
