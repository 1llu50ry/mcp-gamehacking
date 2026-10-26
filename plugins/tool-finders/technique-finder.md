---
name: technique-finder
description: Find implementation examples of specific techniques across all archived source code.
type: tool-plugin
---

# Technique Finder Plugin

Searches archived source code for implementations of specific game hacking techniques.

## Commands

### `find_technique`
Find projects implementing a specific technique.
- Input: technique name (e.g., "silent aim", "dma read", "ept hook", "vmprotect unpack")
- Output: matching projects with code excerpts

### `find_pattern`
Find projects using a specific code pattern or API.
- Input: function/API name (e.g., "NtReadVirtualMemory", "DeviceIoControl", "MmCopyVirtualMemory")
- Output: projects using this API with context

### `find_similar`
Find projects similar to a given one.
- Input: skill name
- Output: related projects by technique overlap

## Technique Categories

- **Injection**: reflective, manual map, process hollowing, APC, thread hijack, EFI map
- **Hooks**: VMT, IAT, inline, .data ptr, EPT, PTE, syscall
- **Memory**: RPM, kernel driver, DMA/FPGA, hypervisor, EFI runtime
- **Rendering**: overlay, canvas hook, DWM, GDI, DirectX/Vulkan/OpenGL hook
- **Stealth**: driver hiding, thread cloaking, trace cleaning, stack spoofing
- **Anti-AC**: callback removal, minifilter bypass, ETW patching, screenshot bypass

## Detailed Specification

### Ecosystem
cross-tool technique catalog -- find implementations by technique name across the full 3,985-source archive

### Query Model
technique name -> source files + language + confidence.

### Entry Fields
name, language, framework, OS, demonstrated pattern.

### Notable Sources
grep_sources + search_skills aggregated.

### Query Interface
- `search(query, filter?)` -> ranked results
- `by_game(name)` -> all tooling for that title
- `by_author(name)` -> author's catalogue
- `freshness(id)` -> last-updated timestamp

### Related Prompts
`find-bypass`, `analyze-cheat`, and the per-tool specialist agent.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
