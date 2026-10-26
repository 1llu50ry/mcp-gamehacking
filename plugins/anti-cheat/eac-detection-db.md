---
name: eac-detection-db
description: Easy Anti-Cheat detection database -- module checks, integrity, overlay detection, telemetry.
type: tool-plugin
---

# Plugin: eac-detection-db

Easy Anti-Cheat detection database -- module checks, integrity, overlay detection, telemetry.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** EasyAntiCheat.sys / EasyAntiCheat_EOS.sys
- **Operating mode:** kernel driver + usermode service + anti-tamper

### Detection Surface
code-section CRC, module enumeration, DeviceIoControl handshake, Steam/EOS integration, hyper-v detection.

### Version Timeline
EAC Classic (pre-Epic acquisition) vs EAC/EOS (Fortnite, Rust, Fall Guys, Apex); hypervisor-aware builds post-2022.

### Bypass Windows
driver patch + handshake replay, DSE off + unsigned driver, EPT-based memory read.

### Related Skills and Projects
Linked skills: `easy-anti-cheat`, `gh-eac-bypass`, `fortnite-specialist`, `apex-specialist`.

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
