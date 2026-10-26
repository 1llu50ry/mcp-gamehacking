---
name: ntapi-reference
description: Undocumented NT API reference -- NtQuerySystemInformation, NtQueryInformationProcess, etc.
type: tool-plugin
---

# Plugin: ntapi-reference

Undocumented NT API reference -- NtQuerySystemInformation, NtQueryInformationProcess, etc.

## Detailed Specification

### Kernel/User Surface
ntdll.dll undocumented NT* and Zw* syscalls

### Key APIs / Routines
NtQuerySystemInformation (SystemModuleInformation, SystemHandleInformation), NtQueryInformationProcess (ProcessBasicInformation, ProcessImageFileName), NtOpenProcess, NtReadVirtualMemory, NtWriteVirtualMemory, NtCreateThreadEx, NtMapViewOfSection, NtQueryVirtualMemory, NtQueryObject.

### Key Structures
SYSTEM_PROCESS_INFORMATION, PROCESS_BASIC_INFORMATION, UNICODE_STRING, OBJECT_ATTRIBUTES, CLIENT_ID.

### Compatibility Notes
signatures change per build; use SysWhispers2/3/Hell's Gate for syscall-only invocation.

### Query Interface
- `routine(name, build?)` -> syscall number, prototype, calling convention
- `struct(name, build?)` -> field layout + size
- `related_apis(name)` -> commonly combined routines
- `undoc_fields(struct)` -> community-reversed fields with provenance

### Related Agents
`windows-internals-agent`, `kernel-callback-researcher`, plus the ntdll/ntoskrnl specialist skills.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
