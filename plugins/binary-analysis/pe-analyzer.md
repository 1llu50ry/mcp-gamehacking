---
name: pe-analyzer
description: PE file format analysis -- headers, sections, imports, exports, resources, relocations.
type: tool-plugin
---

# Plugin: pe-analyzer

PE file format analysis -- headers, sections, imports, exports, resources, relocations.

## Detailed Specification

### File Format
- **Target:** Portable Executable (Windows .exe/.dll/.sys/.ocx)
- **Section/header layout:** DOS stub, PE header, Optional header, section table (.text/.data/.rdata/.rsrc/.reloc), import/export directory, delay-import, TLS, debug, resource tree

### Parsing Libraries
pefile (Python), goblin (Rust), PE-bear, dumpbin, llvm-pdbutil for PDB.

### Common Reverse-Engineering Tasks
import rename, section hashing, Authenticode verification, overlay extraction, resource dump, Rich header parse.

### Related Skills and Projects
`pe-parser`, `iat-hook-builder`, `manual-map-injection`, `import-resolver`

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
