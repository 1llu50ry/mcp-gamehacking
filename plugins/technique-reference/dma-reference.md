---
name: dma-reference
description: DMA/FPGA access methods reference (PCILeech, Screamer, custom firmware).
type: tool-plugin
---

# Plugin: dma-reference

DMA/FPGA access methods reference (PCILeech, Screamer, custom firmware).

## Detailed Specification

### Technique Classification
FPGA DMA (PCILeech), USB3-DMA, Thunderbolt pre-boot DMA, SPI flash, screamer-pcie

### Detection Side-Channels
VT-d IOMMU protection, DMAR table in ACPI.

### Mitigations and Hardening
IOMMU, Secured-core PC.

### Reference Implementations
PCILeech, DMA_FPGA_RUST, Memflow.

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
