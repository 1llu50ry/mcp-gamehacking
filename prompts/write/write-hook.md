---
name: write-hook
description: Implement a specific hook
arguments: 
---

# Implement a specific hook

Search the skill library for reference implementations, techniques, and patterns. Cross-reference with 3,985 archived projects.

## Detailed Workflow
### Goal
hook (any type) for a target function

### Steps
pick type (inline/VMT/IAT/syscall/EPT); gen trampoline + detour; verify no race by stop-the-world install

### Artifacts
hook.cpp with install/uninstall, safetyhook wrapper
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
