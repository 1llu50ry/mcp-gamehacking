---
name: write-driver
description: Design and implement a kernel driver for game memory access or system manipulation.
arguments: 
---

Design a kernel driver for: `{purpose}`.
Communication: {communication}. Stealth: {stealth}.

## Architecture

### 1. Driver Type Selection
- WDM vs KMDF vs minifilter
- Loading method: sc create / vulnerable driver / EFI / manual map

### 2. Core Implementation
Based on purpose, provide:
- IOCTL dispatch (if IOCTL comm)
- .data pointer hook setup (if data-ptr-swap)
- Registry callback registration (if registry-callback)
- Memory R/W primitives (MmCopyVirtualMemory, CR3 walk, MDL)

### 3. Communication Channel
Reference implementations from skill library:
- `driver-communication` -- overview of all methods
- `ags-*` sources with working driver code

### 4. Stealth Measures (if requested)
- PiDDB cleanup
- MmUnloadedDrivers cleanup
- Thread hiding
- Driver object concealment
- Reference: `kernel-hide-stealth`

### 5. Code Template
Provide compilable WDK C code skeleton with:
- DriverEntry / DriverUnload
- Selected communication method
- Memory access primitives
- Error handling

## Detailed Workflow
### Goal
KM driver skeleton

### Steps
DriverEntry + Unload + CreateFile dispatch + DeviceIoControl handler; MDL for user buffer; CTL_CODE enum; signed-cert or BYOVD loader

### Artifacts
driver.c, inf, cat, loader
### Context Gathering Protocol
Before planning:
1. `search_skills` with 3-5 keyword combinations around the task.
2. `read_skill` on the 2-3 most relevant hand-written skills for depth.
3. `grep_sources` across the `ags-*` archive for real implementations.
4. Cross-reference offsets/signatures across multiple sources; use `offset-confidence-scorer`.

### Quality Checklist
- Every offset carries data type + size + source attribution
- Every code block compiles under the declared toolchain
- Every technique carries a detection-risk tier
- Every version-specific detail is labelled with build id
- Every referenced skill actually exists in the library

### Related Prompts
- `analyze-cheat` for architectural context
- `find-bypass` for anti-cheat evasion
- `build-*` for feature implementation
- `reverse-*` for binary analysis
- `write-*` for code generation
- `migrate-*` for cross-version updates

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
