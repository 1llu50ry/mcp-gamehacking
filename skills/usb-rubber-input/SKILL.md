---
name: usb-rubber-input
description: "External USB HID input (Arduino Leonardo, Adafruit ItsyBitsy, Raspberry Pi Pico) for mouse injection that bypasses in-process AC input hooks."
metadata:
  type: tool-reference
  source: curated
  topics: [usb-hid, arduino, pico, input-injection, hardware]
---
# External USB HID Input

Hardware mouse emulator presenting as a legit HID device. AC usermode input hooks can't tell it apart from a real mouse.

## Hardware options

- **Arduino Leonardo / Micro** (ATmega32U4): built-in USB HID. Serial + mouse at once.
- **Raspberry Pi Pico** (RP2040): TinyUSB, dual-core, Python/C.
- **Adafruit ItsyBitsy nRF52840**: BLE + USB.

## Software

- Firmware receives serial commands over a second USB CDC endpoint, emits mouse HID.
- Driver: host sends `(dx, dy, buttons)` per frame.
- Pair with vision-based aim ([[yolo-aim-pipeline]]) for complete hardware-only aim path.

## AC implications

- Vanguard, EAC, BE see legitimate HID.
- Behavioral ML on server side still a signal.

## Related

[[yolo-aim-pipeline]], the `cheat-developer` agent.
