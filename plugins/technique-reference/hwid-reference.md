---
name: hwid-reference
description: HWID collection points and spoof methods per anti-cheat.
type: tool-plugin
---

# Plugin: hwid-reference

HWID collection points and spoof methods per anti-cheat.

## Detailed Specification

### Technique Classification
SMBIOS (DMI), disk serial (ATA Identify), MAC addresses, GPU UUID, CPUID, TPM EK, Volume Serial, machine GUID

### Detection Side-Channels
cross-field consistency, hypervisor spoof detect, HWID history on game accounts.

### Mitigations and Hardening
AC collects multi-source HWID; use a single spoof vector insufficient.

### Reference Implementations
SMBIOS edit via BIOS flash, driver-based spoof (WMI hook), disk-serial IOCTL interception.

### Query Interface
- `list_variants()` -> sub-techniques
- `find_implementations(language?)` -> archive matches
- `detection_vectors()` -> known detection logic per AC
- `platform_requirements()` -> OS build, HVCI/CFG state, driver signing

### Combined Workflow
Pipe into `exploit-chain-builder`, `hook-planner`, or `injection-planner` subagents to compose a complete chain.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
