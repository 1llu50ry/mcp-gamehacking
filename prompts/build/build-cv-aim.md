---
name: build-cv-aim
description: Design a vision-based (CV) aim system
arguments:
  - name: game
    description: Target game name
    required: true
  - name: budget
    description: FPS / latency budget (default 240 FPS / 4 ms)
    required: false
---

# Build Vision-Based Aim

Build a memory-free aim pipeline that detects targets from the rendered frame and emits hardware mouse motion.

## Steps

1. Capture: pick DXGI Desktop Duplication (fast, 240 Hz capable) or OBS virtual camera.
2. Dataset: label 2-5k frames from the game via `roboflow` or manual labelme.
3. Model: train YOLOv8n or RT-DETR-R18 (small for latency); fine-tune on your labelled set.
4. Deploy: TensorRT FP16 export; expect < 2 ms inference on RTX 4080.
5. Humanize: PID + Perlin jitter + timing noise; respect the game's input cadence.
6. Act: hardware HID (Arduino Leonardo / Pico) or interception.sys.

## Skills

- [[yolo-aim-pipeline]]
- [[humanized-aim-jitter]]
- [[usb-rubber-input]]
- [[cloud-gaming-stream-rev]]

## Related Prompts

`build-aimbot` (memory-based), `build-esp` (overlay).
