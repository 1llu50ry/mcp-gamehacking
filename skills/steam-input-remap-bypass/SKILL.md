---
name: steam-input-remap-bypass
description: "Steam Input remap pipeline — how Steam injects `vrpath.dll` + `tier0.dll` hooks, remap state in `userdata/<id>/config/`, bypass strategies that side-step AC input hooks."
metadata:
  type: reference
  source: curated
  topics: [steam, steam-input, input-remap, hid]
---
# Steam Input

Steam Input is Valve's user-mode input remap layer. Routes raw HID → remap profile → virtual DInput/XInput/HID device the game sees.

## Pipeline

- `steam.exe` injects `vrpath.dll` + `tier0.dll` into every launched game.
- Remap profile loaded from `steam/userdata/<account>/config/controller_configs/<app>_*.vdf`.
- Virtual gamepad surfaces via ViGEmBus-equivalent user-space device.

## Why cheats care

- Steam Input sits *before* most anti-cheat usermode input hooks, which watch WM_INPUT.
- A legit-looking profile with 10 ms action-combos is indistinguishable from a human macro at the input layer.
- Combined with [[usb-rubber-input]], gives hardware-plus-software plausibility.

## Related

[[input-remap-raw-input]], [[humanized-aim-jitter]], [[usb-rubber-input]].
