---
name: dotnet-analyzer
description: .NET assembly analysis -- metadata, methods, IL disassembly, obfuscation.
type: tool-plugin
---

# Plugin: dotnet-analyzer

.NET assembly analysis -- metadata, methods, IL disassembly, obfuscation.

## Detailed Specification

### File Format
- **Target:** .NET assemblies (Mono, CoreCLR, Unity-managed)
- **Section/header layout:** CLR header, metadata tables, #Blob/#Strings heaps, MethodDef RVA, PE import of mscoree

### Parsing Libraries
dnSpyEx, ILSpy, dotPeek, Mono.Cecil, PE-bear.

### Common Reverse-Engineering Tasks
method body patching, strong-name bypass, IL-to-C# decompile, Mono Harmony hook, Unity il2cpp sibling detect.

### Related Skills and Projects
`unity-mono`, `harmony-hooks`, `dnspy`

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
