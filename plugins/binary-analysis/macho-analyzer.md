---
name: macho-analyzer
description: Mach-O binary analysis -- load commands, segments, dyld info.
type: tool-plugin
---

# Plugin: macho-analyzer

Mach-O binary analysis -- load commands, segments, dyld info.

## Detailed Specification

### File Format
- **Target:** Mach-O (macOS, iOS, iPadOS, visionOS)
- **Section/header layout:** fat/thin header, LC_SEGMENT_64, LC_SYMTAB, LC_DYSYMTAB, LC_LOAD_DYLIB, chained fixups (iOS 15+), LC_ENCRYPTION_INFO_64

### Parsing Libraries
LIEF, macholib, otool, nm, llvm-otool, jtool2.

### Common Reverse-Engineering Tasks
fat binary split, dyld shared cache extraction, Objective-C class dump, Swift metadata parse, FairPlay DRM analysis.

### Related Skills and Projects
`ios-reverse`, `jailbreak-research`, `dyld-cache`

### Query Interface
Supports `header_info()`, `section_table()`, `imports()`, `exports()`, `relocations()`, `strings()`, `entropy_per_section()`, `signature_match()`, and `patch_bytes()`. Results include byte offsets, VA/RVA, and section provenance.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
