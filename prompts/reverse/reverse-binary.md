---
name: reverse-binary
description: Guide reverse engineering of a binary -- unpacking, analysis strategy, struct recovery.
arguments: 
---

Guide the reverse engineering of `{target}`.

## Analysis Plan

### Phase 1: Triage
- File type, architecture, compiler
- Packer/protector identification
- Import/export analysis
- Section layout and entropy check

### Phase 2: Unpack (if protected)
Based on protection type, recommend tools from `fix-vmp-themida-ollvm`:
- VMProtect → NoVmp, VMPLift, VMPImportFixer
- Themida → unlicense, Magicmida, GhidrOrean
- OLLVM → d810-ng, unflattener
- Unknown → dynamic dump + IAT rebuild

### Phase 3: Static Analysis
- String cross-references
- Import categorization (what APIs = what behavior)
- Control flow graph analysis
- Struct/class recovery from access patterns

### Phase 4: Dynamic Analysis
- Breakpoint strategy
- API monitoring targets
- Memory access patterns
- Network capture (if applicable)

### Phase 5: Goal-Specific Extraction
- Offset tables with validation
- Algorithm pseudocode
- Protocol message formats
- C/C++ struct definitions with static_asserts

## Detailed Workflow
### Goal
static+dynamic triage of a binary

### Steps
DIE/pefile -> IDA/Ghidra pass -> run under x64dbg/WinDbg -> extract offsets, types, strings

### Artifacts
IDB, decompiled .c, IOC YARA, offset JSON
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
