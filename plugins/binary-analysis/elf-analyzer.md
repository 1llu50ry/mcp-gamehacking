---
name: elf-analyzer
description: ELF binary analysis -- sections, symbols, dynamic linking, GOT/PLT.
type: tool-plugin
---

# Plugin: elf-analyzer

ELF binary analysis -- sections, symbols, dynamic linking, GOT/PLT.

## Detailed Specification

### File Format
- **Target:** Executable and Linkable Format (Linux, Android native, PS4/PS5 fakes)
- **Section/header layout:** ELF header, program headers, section headers, .dynsym/.dynstr, .plt/.got, .init_array, DT_NEEDED, GNU_HASH

### Parsing Libraries
pyelftools, LIEF, radare2, readelf, llvm-objdump.

### Common Reverse-Engineering Tasks
symbol resolution, GOT hijacking study, LD_PRELOAD surface mapping, ELF-note parsing, hollowed .text detect.

### Related Skills and Projects
`linux-reverse-engineering`, `frida-elf`

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
