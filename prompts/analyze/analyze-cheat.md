---
name: analyze-cheat
description: Analyze a game cheat's architecture, techniques, and detection surface.
arguments: 
---

Analyze the cheat project `{target}` from our skill library.

Read the skill's SKILL.md and source.txt, then provide:

## 1. Architecture Classification
- Type: internal / external / overlay / DMA / EFI / hybrid
- Engine: UE4/UE5 / Unity Mono/IL2CPP / Source / custom
- Access: RPM / kernel driver / hypervisor / DMA / direct

## 2. Injection Chain
- How does the code get into the target process?
- What privileges are required?
- What vulnerable drivers or exploits are used?

## 3. Feature Set
- ESP / Aimbot / Triggerbot / Wallhack / Radar / Misc
- Rendering method: canvas hook / overlay / GDI / DWM

## 4. Stealth Analysis
- What hiding techniques are used?
- What traces are left?
- What anti-debug/anti-analysis is present?

## 5. Detection Surface
- What would each major AC (BE/EAC/Vanguard/VAC) catch?
- Risk rating: LOW / MEDIUM / HIGH / CRITICAL per AC

## 6. Notable Techniques
- Anything novel or well-implemented worth studying

## Detailed Workflow
### Goal
architecture report for an existing cheat binary

### Steps
unpack + static -> dynamic sandbox -> technique map (hook/injection/comm/UI) -> MITRE classification

### Artifacts
architecture doc, YARA, imphash, hook list
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
