---
name: input-remap-raw-input
description: "Raw Input intercept + remap for games -- WM_INPUT, GetRawInputData, HID collection RID_DEVICE_INFO, how to spoof mouse/keyboard events without being detected as 'software input'."
metadata:
  type: tool-reference
  source: curated
  topics: [raw-input, wm-input, hid, input-spoof, windows]
---
# Raw Input Intercept

Modern games read mouse motion via `WM_INPUT` + `GetRawInputData` to escape mouse acceleration. Spoofing `SendInput` doesn't move the view -- raw input bypasses the cursor pipeline.

## Spoof vectors

- Hook `GetRawInputData` at the game -- rewrite deltas.
- Register your own RID handler early -- WM_INPUT fan-out.
- Driver-level `interception.sys` (nefarius-virtual-devices) -- injects into the kernel input stack before the game sees it.
- Hardware USB HID ([[usb-rubber-input]]) -- bypasses software entirely.

## Related

[[humanized-aim-jitter]], [[usb-rubber-input]], the `cheat-developer` agent.
