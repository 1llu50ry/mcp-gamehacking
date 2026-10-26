---
name: mhyprot-detection-db
description: miHoYo Protect (mhyprot2) detection database -- kernel driver abuse, IOCTL vulns, game protection.
type: tool-plugin
---

# Plugin: mhyprot-detection-db

miHoYo Protect (mhyprot2) detection database -- kernel driver abuse, IOCTL vulns, game protection.

## Data Model

This plugin provides structured access to data sourced from the full skill library (4,161 skills including 3,985 with complete source code archives). Data is organized for efficient lookup and cross-referencing across multiple archived projects.

## Query Interface

The plugin supports multiple query patterns: exact lookup by name or identifier, fuzzy search by keywords or description, filtered listing by category or type, cross-reference queries that combine data from multiple sources, and diff queries that compare values between versions or projects.

## Data Quality

All data returned includes provenance information: which skill or archived project the data was extracted from, when that source was last updated, and whether multiple sources agree on the value. Confidence ratings help consumers decide whether to trust a result or seek additional verification.

## Caching and Performance

The plugin uses the server-side skill directory cache (30-second TTL) for listing operations. Individual skill reads are not cached and always return current data. For bulk operations searching across all archived sources, the plugin uses keyword pre-filtering to avoid reading every source file.

## Integration Points

This plugin is available to all agents and subagents. It is commonly used by the relevant game-specific or engine-specific agent for domain queries, the offset-finder subagent for cross-referencing, the detection-assessor for evaluating technique safety, and the code-analyzer for classifying implementations.

## Update Strategy

Plugin data is as current as the underlying skill library. When new archived projects are added or hand-written skills are updated, the plugin automatically reflects changes on the next query after cache expires. No manual index rebuilding is required.

## Usage Examples

Typical usage patterns include: looking up specific data points across all archived projects, searching for implementations and comparing approaches, generating structured output from patterns found across multiple sources, and building comparison tables across different versions or implementations.

## Detailed Specification

### Target Anti-Cheat
- **Driver / usermode components:** mhyprot2.sys / mhyprot3.sys (Genshin, Honkai, Star Rail)
- **Operating mode:** kernel driver with memory-read IOCTL -- itself a BYOVD vector

### Detection Surface
handle protection, process creation callbacks, pattern scan, telemetry.

### Version Timeline
mhyprot2 (older vuln) still signed; mhyprot3 current; Mihoyo rotates frequently.

### Bypass Windows
unload via vulnerable IOCTL (BYOVD), driver patch, memory-only cheats.

### Related Skills and Projects
Linked skills: `mhyprot`, `mhyprot-byovd`, `byovd`.

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
