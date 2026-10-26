---
name: dex-analyzer
description: Android DEX/APK analysis -- classes, methods, strings, manifest.
type: tool-plugin
---

# Plugin: dex-analyzer

Android DEX/APK analysis -- classes, methods, strings, manifest.

## Detailed Specification

### File Format
- **Target:** Dalvik Executable (Android)
- **Section/header layout:** header, string_ids, type_ids, proto_ids, field_ids, method_ids, class_defs, data section, encoded_methods

### Parsing Libraries
androguard, apkanalyzer, jadx, dex2jar, baksmali.

### Common Reverse-Engineering Tasks
method rename, class hierarchy, Reflection usage, intent extraction, obfuscation measurement.

### Related Skills and Projects
`apk-reverse`, `android-researcher`, `jadx-plugin`

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
