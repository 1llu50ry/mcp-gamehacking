---
name: hook-library
description: Reference library of all hook types with implementation examples, detection vectors, and anti-cheat compatibility.
type: tool-plugin
---

# Hook Library Plugin

Comprehensive reference for hooking techniques with real implementations from the skill archive.

## Commands

### `hook_lookup`
Get details on a specific hook type.
- Input: hook type (e.g., "VMT", "IAT", "inline", "EPT", "syscall", ".data ptr")
- Output: how it works, code example, detection vectors, AC compatibility

### `hook_for_target`
Find the best hook type for a specific target.
- Input: target description (e.g., "UGameViewportClient::PostRender", "NtReadVirtualMemory")
- Output: recommended hook types ranked by stealth, with implementation refs

### `hook_detect_matrix`
Detection matrix for hook types across anti-cheats.
- Input: anti-cheat name (optional, all if omitted)
- Output: table of hook types vs detection status

## Hook Types Covered

VMT, IAT, inline (detour), .data pointer, EAT, exception handler, debug register (HWBP), page guard, EPT/NPT, syscall, WMI callback, registry callback, object callback, minifilter, PsSetCreateProcessNotifyRoutine, ETW provider

## Detailed Specification

### Technique Classification
same as hooking-reference but with code examples + detection vectors + stability notes

### Detection Side-Channels
integrity callbacks.

### Mitigations and Hardening
trampoline cleanup, re-hook on module reload.

### Reference Implementations
safetyhook, MinHook, PolyHook, Detours, kiero present-hook.

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
