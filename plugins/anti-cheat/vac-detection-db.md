---
name: vac-detection-db
description: Valve Anti-Cheat detection database -- module scanning, signature matching, convars.
type: tool-plugin
---

# Plugin: vac-detection-db

Valve Anti-Cheat detection database -- module scanning, signature matching, convars.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** no kernel driver -- usermode process scan
- **Operating mode:** Steam client sidecar, async signature matching + VACnet (server-side ML on CS2)

### Detection Surface
module hash, memory signature scan, DLL enumeration, injected-thread detection, VACnet behavior model.

### Version Timeline
VAC2 (Source 1), VAC3 (Source 2/CS2), VACnet 3.0 (CS2 server-side).

### Bypass Windows
manual map without touching loader lists, signature-less modules, server-side behavior shaping.

### Related Skills and Projects
Linked skills: `gh-vac-bypass`, `cs2-specialist`, `source-engine-specialist`.

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
