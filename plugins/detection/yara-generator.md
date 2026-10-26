---
name: yara-generator
description: Generate YARA rules from archived cheat sources for detection and classification.
type: tool-plugin
---

# YARA Generator Plugin

Generates YARA detection rules by analyzing cheat source code patterns across the skill library.

## Commands

### `gen_yara`
Generate a YARA rule for detecting a specific technique or project.
- Input: skill name or technique description
- Output: YARA rule with strings, conditions, and metadata

### `gen_yara_family`
Generate rules for a family of related projects.
- Input: category (e.g., "kdmapper variants", "valorant externals", "dma cheats")
- Output: family detection rule covering common patterns

### `validate_yara`
Check if a YARA rule matches expected targets and has no false positives.
- Input: YARA rule text
- Output: match results against archived sources

## Built-in Rule Templates

Reference: `yara-pe-artifact-scanner` skill contains 14 ready-made rules:
- ReflectiveLoader, Meterpreter, CobaltStrike
- ClassicInjection, Hollowing, ETWPatch, AMSIPatch
- NTDLLUnhook, Packed, Mimikatz
- EntryAnomaly, BigOverlay, Sideload, DirectSyscall

## Detailed Specification

### Detection Surface
Generate YARA rules from archived cheat sources for detection and classification.

### Data Model
YARA rule skeleton -- strings + condition.

### Data Sources
cheat binaries from the archive, known-good references.

### Detection Primitives
wildcarded hex, PE import hash, section entropy threshold, Rich header match.

### Notable Signatures
pattern + unique-string + math.entropy > 7.0.

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
