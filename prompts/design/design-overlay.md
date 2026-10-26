---
name: design-overlay
description: Design a rendering overlay architecture -- method selection, anti-detection, performance optimization.
arguments: 
---

Design a rendering overlay using `{method}` for `{game}`.
Features: {features}

## Architecture

### 1. Rendering Method
- External D3D11 window overlay (transparent, topmost, click-through)
- DWM hijack (attach to existing window)
- Canvas hook (UE4/UE5 PostRender UFunction)
- GDI overlay (simple, detected)
- Present hook (IDXGISwapChain::Present VMT)

### 2. Window Setup
- WS_EX_TRANSPARENT, WS_EX_LAYERED, WS_EX_TOPMOST
- DwmExtendFrameIntoClientArea for transparent background
- Anti-screenshot measures (SetWindowDisplayAffinity)

### 3. Rendering Pipeline
- D3D11 device/swapchain creation
- ImGui integration (or raw D3D draw calls)
- Frame synchronization with game
- Multi-threaded rendering considerations

### 4. Detection Surface
- Window enumeration (EnumWindows, FindWindow)
- OBS/capture tool bypass
- AC screenshot detection
- DWM composition checks

### 5. Reference Implementations
Search skill library for working overlay code.

## Detailed Workflow
### Goal
Design a rendering overlay architecture -- method selection, anti-detection, performance optimization.

### Steps
Collect requirements -> list constraints -> enumerate options -> trade-off matrix -> pick + document ADR.

### Artifacts
Source files + README + offset/signature JSON + verification steps.
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
