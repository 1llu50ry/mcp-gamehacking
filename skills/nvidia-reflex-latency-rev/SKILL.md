---
name: nvidia-reflex-latency-rev
description: "NVIDIA Reflex latency pipeline reversing -- how NVAPI exposes PCL (PC Latency) stats, where games call `NvAPI_D3D_SetLatencyMarker`, how aim-tooling benefits from PCL frame IDs."
metadata:
  type: reference
  source: curated
  topics: [nvidia, reflex, pcl, latency, nvapi]
---
# NVIDIA Reflex

NVIDIA Reflex pipelines frame submission to minimise PC+display latency. Modern shooters (CS2, Fortnite, Overwatch 2, Valorant, Apex, THE FINALS) call Reflex markers around input→render→present.

## RE pointers

- Entry: `nvapi64.dll` exports `NvAPI_QueryInterface(0x0D4F3C1F)` → low-latency table.
- Game-side: `NvAPI_D3D_SetLatencyMarker` at frame boundaries (`SIMULATION_START`, `RENDERSUBMIT_END`, `PRESENT_START/END`, `INPUT_SAMPLE`).
- Reflex writes PCL stats into shared GPU memory a monitor can read.

## Why cheats care

- Reflex markers expose exact frame-id → input-sample timing to game code. External aim pipelines ([[yolo-aim-pipeline]]) can read PCL stats via NVAPI without any in-process hook and prefire humanisation from the same frame-id a human would see.

## Related

[[humanized-aim-jitter]], [[yolo-aim-pipeline]].
