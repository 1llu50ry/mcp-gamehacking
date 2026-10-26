---
name: w2s-calculator
description: World-to-screen projection math reference for all common engines.
type: tool-plugin
---

# Plugin: w2s-calculator

World-to-screen projection math reference for all common engines.

## Detailed Specification

### Concept
world-to-screen projection via view matrix

### Mathematics / Formula
```
P_clip = M * P_world; NDC = P_clip.xyz / P_clip.w; Screen.x = (NDC.x+1)*0.5*W; Screen.y = (1-NDC.y)*0.5*H
```

### API / Format Variants
row-major vs column-major, OpenGL (Z in [-1,1]) vs D3D (Z in [0,1]), reverse-Z.

### Reference Implementations
SDL2, DirectXMath, glm; derived view+proj matrix via CB inspection or engine helper.

### Common Pitfalls
- Row-major vs column-major matrix ordering
- OpenGL vs D3D clip-space (Z range differs)
- Reverse-Z depth buffers in modern engines
- MSAA resource access (resolve required before CPU read)

### Related Skills
`present-hook-detection`, `imgui-widget-library`, `w2s-calculator`, plus the engine-specific rendering skill.

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
