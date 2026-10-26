---
name: write-injector
description: Design an injection chain -- method selection, payload preparation, stealth measures.
arguments: 
---

Design injection into `{target}` using `{method}`.
Stealth: {stealth}

## Injection Chain

### 1. Payload Preparation
- PE stripping (remove DOS header, rich header, debug directory)
- Import resolution strategy
- TLS callback handling
- Exception directory setup

### 2. Memory Allocation
- NtAllocateVirtualMemory (usermode)
- MmCopyVirtualMemory / physical write (kernel)
- Section mapping (NtCreateSection + NtMapViewOfSection)

### 3. Code Execution
- APC injection (NtQueueApcThread)
- Thread hijack (SuspendThread + SetThreadContext)
- Thread creation (NtCreateThreadEx)
- Callback-based (TLS, DllMain via LdrLoadDll)
- Instrumentation callback

### 4. Cleanup
- Header erasure
- PE header wiping
- Thread start address spoofing
- Stack spoofing for return address

### 5. Reference Implementations
Search skill library for working injectors.

## Detailed Workflow
### Goal
injector binary for a target

### Steps
pick method (manual-map/APC/CreateRemoteThread); import resolver, relocations, TLS, exception handlers

### Artifacts
injector.cpp, PE parser header, support DLL
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
