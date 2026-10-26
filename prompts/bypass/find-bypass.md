---
name: find-bypass
description: Find bypass techniques for a specific anti-cheat system or protection.
arguments: 
---

Search the skill library for bypass techniques against `{anti_cheat}`.

## Steps

1. Search skills for the AC name and known bypass projects
2. Read relevant source code to extract working techniques
3. Cross-reference with detection assessments
4. Rank by stealth level and reliability

## Output

For each technique found:
- **Method**: What it does
- **Skill**: Source skill reference
- **Stealth**: LOW / MEDIUM / HIGH
- **Status**: Working / Patched / Unknown (note version if known)
- **Requirements**: Kernel access? UEFI? Hardware?
- **Code snippet**: Key implementation excerpt if available

## Detailed Workflow
### Goal
find existing bypass examples in archive for given AC

### Steps
search_skills + grep_sources -> rank by freshness + source size -> annotate detection surface

### Artifacts
ranked list of relevant projects
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
