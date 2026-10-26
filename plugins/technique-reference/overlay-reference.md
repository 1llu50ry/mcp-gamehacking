---
name: overlay-reference
description: Overlay rendering methods reference (external D3D, DWM, canvas, GDI).
type: tool-plugin
---

# Plugin: overlay-reference

Overlay rendering methods reference (external D3D, DWM, canvas, GDI).

## Detailed Specification

### Technique Classification
DX present hook, Vulkan vkQueuePresent, OpenGL wglSwapBuffers, in-process ImGui, external window transparent overlay, DWM composition hook, EFI pre-boot

### Detection Side-Channels
window enumeration, present-pointer check, D3D SwapChain enumeration.

### Mitigations and Hardening
legit Steam/NVIDIA overlays whitelisted; cheat overlays detected.

### Reference Implementations
ImGui overlays, Direct2D top-most, wintab.

### Query Interface
- `list_variants()` -> sub-techniques
- `find_implementations(language?)` -> archive matches
- `detection_vectors()` -> known detection logic per AC
- `platform_requirements()` -> OS build, HVCI/CFG state, driver signing

### Combined Workflow
Pipe into `exploit-chain-builder`, `hook-planner`, or `injection-planner` subagents to compose a complete chain.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
