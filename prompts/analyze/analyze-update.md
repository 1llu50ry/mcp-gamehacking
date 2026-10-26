---
name: analyze-update
description: Analyze a game update to find offset changes, new functions, struct layout shifts, and broken patterns.
arguments: 
---

Analyze a game update for `{game}`.
Known changes: {changes}

## Analysis Steps

### 1. Offset Migration
- Compare known offsets from skill library against update
- Identify shifted, removed, or new offsets
- Generate updated offset table

### 2. Struct Changes
- Check UObject/AActor/ACharacter layout changes
- Detect new fields, removed fields, reordered fields
- Update struct definitions

### 3. Pattern Validation
- Test all known byte patterns against new binary
- Flag broken patterns
- Generate replacement patterns

### 4. New Function Discovery
- Identify newly added functions of interest
- Classify by purpose (networking, rendering, anti-cheat, gameplay)

### 5. Anti-Cheat Changes
- Check for new AC modules or detection methods
- Identify driver signature changes
- Note new integrity checks

## Detailed Workflow
### Goal
track offset migration between game updates

### Steps
diff two binaries (binary-diff / BinDiff / Diaphora) -> re-anchor known-good offsets -> emit migration map

### Artifacts
offset diff JSON, re-anchored SDK
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
