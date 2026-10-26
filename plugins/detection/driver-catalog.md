---
name: driver-catalog
description: Catalog of vulnerable and useful kernel drivers -- LOLDrivers cross-reference, exploit primitives, detection status.
type: tool-plugin
---

# Driver Catalog Plugin

Database of kernel drivers with known vulnerabilities, exploit primitives, and detection status.

## Commands

### `driver_lookup`
Find a vulnerable driver by name or CVE.
- Input: driver name (e.g., "iqvw64e", "gdrv", "mhyprot2") or CVE
- Output: vuln type, exploit primitive, known mappers using it, detection status

### `driver_search`
Search drivers by capability needed.
- Input: capability (e.g., "arbitrary read write", "physical memory", "MSR access")
- Output: matching drivers ranked by stealth and reliability

### `driver_alternatives`
Find alternative drivers when one is detected.
- Input: blocked driver name
- Output: alternatives with same primitives, detection comparison

### `driver_detect_status`
Check detection status across anti-cheats.
- Input: driver name
- Output: blocked/allowed per AC (BE, EAC, Vanguard, FACEIT)

## Detailed Specification

### Detection Surface
Catalog of vulnerable and useful kernel drivers -- LOLDrivers cross-reference, exploit primitives, detection status.

### Data Model
JSON per driver (name, SHA256, OEM, signer, imported IOCTLs, vuln class, exploit primitive).

### Data Sources
loldrivers.io, Microsoft blocklist, winget, awesome-vuln-driver-list.

### Detection Primitives
arbitrary read, arbitrary write, phys mem map, MSR read/write, CR3 switch, callback kill.

### Notable Signatures
mhyprot2, rtcore64, iqvw64e, truesight, winring0, zemana, kprocesshacker.

### Query Interface
- `scan(target)` -> list of matches with severity
- `rules()` -> installed rule catalog
- `add_rule(spec)` -> load custom detection
- `whitelist(id)` -> suppress false positives per environment

### Related Agents
`anti-cheat-analyst`, `malware-analyst`, `windows-internals-agent`, plus the per-detection specialist in `techniques/`.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
