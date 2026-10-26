---
name: faceit-detection-db
description: FACEIT Anti-Cheat detection database -- driver, ring0 checks, integrity, screenshot.
type: tool-plugin
---

# Plugin: faceit-detection-db

FACEIT Anti-Cheat detection database -- driver, ring0 checks, integrity, screenshot.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** faceitclient.sys
- **Operating mode:** kernel driver + usermode client; stricter than VAC on CS2

### Detection Surface
handle enumeration, screenshot capture, driver list, memory signature, inter-match screenshot upload.

### Version Timeline
FACEIT AC Client 1.x -- regular updates monthly.

### Bypass Windows
DMA (PCILeech/Screamer), external hardware, kernel-mode stealth.

### Related Skills and Projects
Linked skills: `gh-faceit-bypass`, `dma-specialist`, `pcileech`.

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
