# Capabilities And Core Techniques

## Attacker Capability and Defensive Coverage

For threats beyond local runtime access, use
[game-server-security](../../game-server-security/SKILL.md) for backend authority
and transactional correctness, and
[game-supply-chain-security](../../game-supply-chain-security/SKILL.md) for build,
release and mod trust. Each extends the attack taxonomy with its own prerequisites.

Read the [attack surface map](attack-surface-map.md) when comparing
attack families or building a defense coverage matrix. It includes client-state
exposure, manipulation, injection, privileged acquisition, visual/input
automation, and abuse of server trust, with prerequisites and counterexamples.

For each relevant family, explain the attack objective and boundary before
naming tools. Identify what the defender can actually observe, what control
prevents or limits the behavior, and what remains uncertain. Distinguish
read-only information abuse from state modification, and synthetic input from
evidence of human intent. Avoid presenting a missing artifact as proof that an
attack is undetectable.

Cross-reference [DMA acquisition](../../dma-attack/references/acquisition-and-transport.md)
for host-driver versus device access, and
[network evidence](../../anti-cheat/references/network-environment-evidence.md)
for account/device association and reported restrictions.

Treat implementations, performance numbers, stealth rankings, and detection
claims as versioned threat-model examples rather than guarantees. Use
[`research-rigor`](../../research-rigor/SKILL.md) when converting them into a
factual claim or defensive decision.

## Escalation Model

### User-Mode
- Read and write process memory
- Inject DLLs or shellcode
- Hook graphics or input APIs

### Kernel-Mode
- Use signed or vulnerable drivers for direct memory access
- Bypass handle-based protections and inspect protected processes
- Interact with callbacks, page tables, or kernel objects directly

### Below the OS
- Virtualize the system with a hypervisor
- Read memory through PCIe DMA hardware
- Move logic to external devices or secondary machines

## Core Concepts

### Memory Manipulation
- Read Process Memory (RPM)
- Write Process Memory (WPM)
- Pattern scanning
- Pointer chains
- Structure reconstruction

### Process Injection
- DLL injection methods
- Manual mapping
- Shellcode injection
- Thread hijacking
- APC injection

### Hooking Techniques
- Inline hooking (detours)
- IAT/EAT hooking
- VTable hooking
- Hardware breakpoint hooks
- Syscall hooking

## Cheat Categories

### Visual Cheats (ESP)
```
- World-to-Screen transformation
- Player/entity rendering
- Box ESP, skeleton ESP
- Item highlighting
- Radar/minimap hacks
```

### Aim Assistance
```
- Aimbot algorithms (memory-based and AI visual)
- Triggerbot (auto-fire on crosshair detection)
- No recoil/no spread
- Bullet prediction and lead calculation
- Silent aim (server-side angle manipulation)
- AI visual aimbot (YOLO-based, no memory access required)
```

### AI Visual Cheats (Computer Vision Aimbot)
```
Architecture overview:
Screen-capture paradigm — uses frame capture, object detection, and input
injection. Some implementations can avoid process attachment, a cheat driver,
and direct game-memory reads; that does not make the full pipeline artifact-free.

Typical setup:
┌─────────────────┐     screen capture      ┌──────────────────┐
│  Gaming PC      │ ───────────────────────▶ │  AI Pipeline     │
│  Game + OBS     │                          │  (same PC, or    │
│                 │ ◀─────────────────────── │   second PC)     │
└─────────────────┘     hardware input       │  YOLO model      │
                        (KMBox / Logitech)   │  TensorRT/CUDA   │
                                             └──────────────────┘

Dual-machine variant (separate processing location):
- Machine A (game): only runs game + OBS, sends frames via NDI/capture card
- Machine B (cheat): runs AI model, sends mouse commands via USB/network
  to hardware input device on Machine A
- Game machine need not run the model or decision logic, though capture,
  transport, and input-device artifacts can remain

Single-machine variant:
- OBS + AI model run on the same PC
- AI implemented as OBS filter plugin (looks like "OBS is running")
- Mouse output via hardware device or driver-level injection

Pipeline stages:

1. Frame Source Evidence:
   - Identify the actual source/backend and retained frame stage; a source label
     does not establish hook use, display coverage or a fixed frame rate
   - Treat capture plugins and external capture devices as separate provenance
     questions, and compare against legitimate recording configurations
   - Evaluate capture semantics using the graphics-api skill before interpreting
     a missing image or a process/module observation

2. AI Object Detection:
   - Model: YOLOv5 / YOLOv8 / YOLOv10 / YOLO11 (lightweight variants)
   - Training: fine-tuned on game-specific screenshots
     (enemy bodies, heads, torsos as labeled bounding boxes)
   - Input: cropped region around crosshair (320x320 or 640x640)
     to reduce inference cost
   - Output: bounding boxes with class (head/body/enemy) + confidence score
   - Acceleration: TensorRT (NVIDIA), CUDA, DirectML, OpenVINO
   - Set and measure the latency budget on the target capture path, model,
     hardware, frame rate, and input transport

3. Coordinate Transform and Aiming Logic:
   - Convert pixel coordinates to mouse movement delta:
     delta_x = (target_x - screen_center_x) * sensitivity
     delta_y = (target_y - screen_center_y) * sensitivity
   - Target selection: closest to crosshair, highest confidence,
     head priority, or combined scoring
   - FOV (Field of View) lock: only engage targets within
     configurable pixel radius from crosshair center

4. Attempts to mask automated trajectories:
   - Gradual movement with an acceleration curve instead of an instant snap
   - Synthetic jitter
   - Bézier curve or cubic interpolation for path
   - End-point correction (overshoot then settle)
   - Configurable engagement probability
   - Slight intentional offset (not pixel-perfect center-mass)
   - Variable reaction delay
   These transformations do not establish human equivalence; repeated
   parametric behavior can itself become a feature.

5. Mouse Movement Execution:
   - Hardware input devices (see Input Simulation section below)
   - Movement commands sent as physical HID reports
   - The host receives protocol-conformant HID input rather than a user-mode
     injection API call; device provenance and behavior may still be observable

Why OBS specifically:
- Legitimate streaming software, used by millions of streamers
- Blanket action against OBS-related processes would create substantial
  collateral impact; process presence alone is not attribution
- Game Capture provides fast, low-latency frame access
- Plugin system can host filters inside OBS, but loaded plugins, behavior, and
  surrounding telemetry may still be inspected
- Supports D3D11, D3D12, Vulkan, OpenGL capture paths
```

### YOLO Model Training Pipeline (for Game AI Aimbot)
```
End-to-end workflow from raw game screenshots to deployed TensorRT model.

1. Data Collection:
   - Capture game screenshots during actual gameplay (OBS recording or replay)
   - Capture diverse scenarios: different maps, lighting, character skins,
     distances, poses, partial occlusion, smoke/flash effects
   - Determine dataset size from coverage and learning curves; image count alone
     does not guarantee robustness
   - Include negative samples (empty scenes, friendlies, environment objects)

2. Annotation / Labeling:
   - Tools: LabelImg (YOLO format), CVAT (collaborative), Roboflow (cloud),
     Label Studio, makesense.ai (browser-based)
   - YOLO format: one .txt per image, each line:
     <class_id> <center_x> <center_y> <width> <height>
     (all values normalized to 0-1 relative to image dimensions)
   - Class definitions (typical):
     0: enemy_body (full body bounding box)
     1: enemy_head (head-only bounding box, for headshot targeting)
     2: friendly (to avoid shooting teammates)
   - Label head separately from body for head-priority targeting
   - Quality control: consistent label boundaries, no missed instances

3. Data Augmentation:
   - Built-in Ultralytics augmentations (mosaic, mixup, copy-paste)
   - Game-specific augmentations:
     - Brightness/contrast variation (simulate different map lighting)
     - Random crop around crosshair area (match inference ROI)
     - Motion blur (simulate fast movement)
     - Noise injection (simulate compression artifacts)
   - Avoid augmentations that distort aspect ratio
     (characters would look unnatural, hurting accuracy)

4. Training:
   - Framework: Ultralytics YOLOv8/v10/v11/YOLO11
   - Base model: yolov8n.pt or yolov8s.pt (nano/small for speed)
     or yolo11n.pt for latest architecture
   - Training command:
     yolo detect train data=game_dataset.yaml model=yolov8n.pt
       epochs=100 imgsz=640 batch=16 device=0
   - dataset.yaml structure:
     path: /path/to/dataset
     train: images/train
     val: images/val
     names: {0: enemy_body, 1: enemy_head, 2: friendly}
   - Key hyperparameters to tune include input size, learning rate, confidence
     threshold, NMS IoU threshold, batch size, and augmentation policy
   - Measure training and inference cost on the exact model, software stack,
     precision, and target hardware

5. Validation and Testing:
   - Evaluate mAP@0.5 and mAP@0.5:0.95 on validation set
   - Choose operating thresholds from precision/recall and downstream error
     costs; no single mAP cutoff establishes reliable deployment
   - Test inference speed on target hardware and evaluate held-out maps, skins,
     patches, capture paths, and hard negatives

6. Export to TensorRT (deployment):
   - Step 1: Export to ONNX
     yolo export model=best.pt format=onnx simplify=True opset=17
   - Step 2: Convert ONNX to TensorRT engine
     yolo export model=best.pt format=engine half=True device=0
     (half=True enables FP16 precision)
   - Or use trtexec directly:
     trtexec --onnx=best.onnx --saveEngine=best.engine
       --fp16 --workspace=4096
   - Benchmark FP16 against FP32 on the exported model; latency, throughput, and
     accuracy changes are hardware- and graph-specific
   - INT8 can improve throughput but requires representative calibration data
     and accuracy validation

7. Runtime Integration:
   - Load TensorRT engine in C++/Python inference loop
   - Input: preprocessed frame (resize, normalize, HWC→CHW, float32/16)
   - Decode the exporter/version-specific output tensor; shapes and NMS
     placement vary across model and runtime versions
   - Apply NMS (Non-Maximum Suppression) to deduplicate detections
   - Select target based on: closest to crosshair + highest confidence
   - Convert pixel coordinates to mouse delta

Alternative acceleration backends:
- DirectML (AMD GPUs, Windows native)
- OpenVINO (Intel GPUs/CPUs)
- ONNX Runtime with CUDA EP (cross-platform)
- CoreML (macOS, less common for game cheats)
```

### Movement Cheats
```
- Speed hacks
- Fly hacks
- No clip
- Teleportation
- Bunny hop automation
```

### Miscellaneous
```
- Wallhacks
- Skin changers
- Unlock all
- Economy manipulation
```
