---
name: anti-cheat-timeline
description: Track anti-cheat updates, detection waves, and bypass shelf-life across BattlEye, EAC, Vanguard, VAC, FACEIT.
type: tool-plugin
---

# Anti-Cheat Timeline Plugin

Tracks anti-cheat evolution and bypass effectiveness over time.

## Commands

### `ac_latest`
Get latest known detection capabilities for an anti-cheat.
- Input: anti-cheat name (BE, EAC, Vanguard, VAC, FACEIT)
- Output: current detection methods, recent additions, known bypasses still working

### `ac_bypass_history`
History of bypasses for a specific technique.
- Input: technique (e.g., "manual map", "EPT hook", "HWID spoof")
- Output: timeline of when it worked, when detected, current status per AC

### `ac_compare`
Compare detection capabilities between anti-cheats.
- Input: two AC names
- Output: side-by-side comparison of detection methods and coverage

### `ac_detect_method`
Detailed explanation of a specific detection method.
- Input: detection method (e.g., "stack walking", "module enumeration", "timing attack", "hypervisor detection")
- Output: how it works, which ACs use it, known evasion techniques

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** cross-AC
- **Operating mode:** update-tracking database for all major anti-cheats

### Detection Surface
AC version → added detection vector mapping; bypass shelf-life per technique.

### Version Timeline
chronological per-AC updates: BE kernel changes, EAC hyper-v enforcement, Vanguard TPM mandate, Byfron VM mutations.

### Bypass Windows
half-life of each technique by AC/version.

### Related Skills and Projects
Linked skills: `battleye-detection-db`, `eac-detection-db`, `vanguard-detection-db`, `faceit-detection-db`.

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
