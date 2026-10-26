---
name: yolo-aim-pipeline
description: "Vision-based (YOLO / Detectron / RT-DETR) aim pipeline -- how to train on in-game frames, deploy via TensorRT, hook mouse input, humanize aim with jitter model."
metadata:
  type: tool-reference
  source: curated
  topics: [yolo, cv-aim, tensorrt, ml-aim, vision]
---
# Vision-Based Aim Pipeline

Memory-free aim. Train a target detector on in-game frames, deploy as a real-time inference loop, send mouse input to the OS.

## Pipeline

1. Capture: `DXGI Desktop Duplication` or `obs-studio` virtual camera; 300-500 FPS modern GPUs.
2. Detect: YOLOv8/9 or RT-DETR fine-tuned on labelled frames (`roboflow` has datasets).
3. Deploy: `TensorRT` export, FP16 or INT8.
4. Act: `SendInput` or hardware-emulated mouse (Arduino Leonardo + HIDAPI).

## AC implications

- No in-game process -> VAC/BE/EAC blind.
- Hardware mouse works even against Vanguard.
- Server-side behavior ML (VACnet, Overwatch 2 Watchdog, Fortnite behavior) still fires.

## Related

[[cloud-gaming-stream-rev]], the `cheat-developer` agent.
