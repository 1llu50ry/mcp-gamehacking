---
name: build-cheat
description: Design a cheat architecture for a specific game with feature requirements.
arguments: 
---

Design a complete cheat architecture for `{game}` ({engine}) with features: {features}.
Stealth target: {stealth}.

## Deliverables

### 1. Architecture Blueprint
- Access method selection (RPM / driver / DMA / EFI) based on stealth requirement
- Injection method (if internal) or overlay method (if external)
- Communication channel design
- Thread model and data flow

### 2. Per-Feature Implementation Plan
For each requested feature:
- Required offsets and how to find them
- Algorithm (e.g., FOV-based aim, bone W2S, color trigger)
- Rendering method
- Reference implementations from skill library

### 3. Anti-Cheat Evasion
- Detection surface analysis for the game's AC
- Required stealth measures at chosen level
- Recommended hiding/spoofing techniques

### 4. Reference Projects
- Search skill library for similar projects on this game/engine
- Extract reusable code patterns

### 5. Offset Table
- All required offsets with current known values
- Pattern signatures for auto-updating

## Detailed Workflow
### Goal
full cheat skeleton

### Steps
feature matrix (ESP/aim/trigger/misc) -> engine SDK -> hook strategy -> config/UI -> loader + comm channel -> stealth layer

### Artifacts
complete repo with build system, SDK, loader, DLL/driver
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
