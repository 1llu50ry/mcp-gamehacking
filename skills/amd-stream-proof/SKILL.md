---
name: amd-stream-proof
description: "AMD Streaming Proof — AMD-side equivalent of [[nvidia-shadowplay-bypass]]. Patches AMD AMF / ReLive detection surfaces so anti-cheat capture-presence probes return 'no' on AMD GPUs."
metadata:
  type: reference
  source: curated
  topics: [amd, amf, relive, capture-detect, bypass]
---
# AMD Streaming Proof

Mirror of [[nvidia-shadowplay-bypass]] for AMD GPUs.

## Surfaces

- `amdxc64.dll` / `amfrt64.dll` export table — AMF (Advanced Media Framework) runtime detection.
- AMD Software (ReLive) IPC pipe — `\\.\pipe\amd-radeon-settings`.
- Driver device object `\Device\AMDxx` — detection via `NtQueryObject`.

## Technique

- Enumerate AMD services (`AMD External Events Utility`, `AMD Crash Defender Service`).
- Manual-map shim DLL (or kernel-mode byte patch) that returns 'disabled' on relevant query APIs.
- Pair with [[nvidia-shadowplay-bypass]] so cheat is capture-cloaked regardless of GPU vendor.

## Related

[[nvidia-shadowplay-bypass]], [[anti-screenshot]], [[dxvk-vkd3d-hook]].
