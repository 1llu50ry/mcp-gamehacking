---
name: fpga-dma-screamer
description: "Screamer PCIe / LeetDMA / PCILeech FPGA setup -- bitstream, LeechCore driver, PCIe memory R/W primitive, IOMMU avoidance, and anti-cheat implications."
metadata:
  type: tool-reference
  source: curated
  topics: [fpga, pcileech, screamer, dma, pcie, iommu]
---
# PCILeech FPGA (Screamer / LeetDMA)

Hardware-level DMA attack platform. A PCIe FPGA board (Screamer-PCIe, LeetDMA, PCIeScreamer, enigma-x1) presents itself as a benign device; LeechCore driver bridges to host software (MemProcFS, PCILeech CLI, Memflow).

## Wiring

- Plug into an open PCIe x1 slot. For laptops: ExpressCard or OCuLink.
- Fallback over USB3 for development (slower).

## Software

- `MemProcFS` -- live kernel-memory FS mount.
- `pcileech` CLI -- dump/kmd/ldp primitives.
- `Memflow` connectors -- Rust pluggable readers.

## IOMMU

- VT-d / AMD-Vi off by default on gaming boards; AC vendors cannot force it on.
- Secured-core PCs do force VT-d; FPGA DMA loses primitive. Workaround: VMM-side.

## Anti-cheat visibility

- Game process never touched; aim host runs on a second PC with FPGA target bridge.
- Camera-based aim + overlay-free (no software in-process on gaming PC).

## Related

[[dma-reference]], [[pcileech-mcp]], [[memflow-mcp]], the `dma-specialist` agent.
