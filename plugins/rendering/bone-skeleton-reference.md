---
name: bone-skeleton-reference
description: Standard skeleton bone maps and indices per game and engine.
type: tool-plugin
---

# Plugin: bone-skeleton-reference

Standard skeleton bone maps and indices per game and engine.

## Detailed Specification

### Concept
per-engine bone index enumeration

### Mathematics / Formula
```
Position = BoneMatrix * (0,0,0,1); world space bone position
```

### API / Format Variants
UE4 FTransform array vs Source bone[], Unity Transform component chain.

### Reference Implementations
ReClass dumps, SDK gen, SkeletalMesh component.

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
