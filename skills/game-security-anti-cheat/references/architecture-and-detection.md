# Architecture And Detection

## Threat Coverage and Enforcement Evidence

For input units, uploaded fields or missing events, use
[input provenance and measurement](input-provenance-and-measurement.md).
For service faults, shadow/canary evaluation, rollout and affected decisions, use
[detector operations](detector-operations.md).

Separate detector design from
[server/backend correctness](../../game-server-security/SKILL.md). For native Linux,
SteamOS and Proton observations, use
[linux-platform-security](../../linux-platform-security/SKILL.md) before applying
Windows-specific assumptions.

Describe each threat by the capability needed, resource exposed, trust boundary
crossed, and observation point available to the defender. Compare host, device,
graphics, input, and server observations without assuming one collector sees all
layers. Use the [attacker capability map](../../game-hacking/references/attack-surface-map.md)
for cross-layer classification, including attacks that do not modify game memory.

For shared networks, account/device association, reported network restrictions,
or claimed sanction duration, read
[Network environment evidence](network-environment-evidence.md).
Keep connection failure, rate limiting, detection, and enforcement as separate
events. A common address, acquisition driver, or unusual input device needs
context and corroboration before attribution.

For firmware-tier, EPT/DMA, HVCI, containment, or TPM certainty claims, use
[assurance boundaries](../../dma-attack/references/assurance-boundaries.md).

For a two-computer memory setup, first use
[acquisition and transport classification](../../dma-attack/references/acquisition-and-transport.md).
PCIe inspection addresses a different surface from host-driver acquisition;
neither observation alone establishes the entire system's integrity.

Produce an evidence record containing the affected build, claimed attacker
capability, collector and visibility limits, observation timeline, benign
controls, supported finding, and remaining uncertainty. Consult
[research-rigor](../../research-rigor/SKILL.md) when evaluating a detector or
turning a finding into an enforcement recommendation.

## Major Anti-Cheat Systems

### Easy Anti-Cheat (EAC)
- Multi-component architecture with service, driver, and game-facing protections
- Process integrity verification and memory inspection
- Runtime driver loading with strong client-side enforcement
- Used by: Fortnite, Apex Legends, Rust

### BattlEye
- Kernel driver plus service and game module coordination
- Handle protection, process monitoring, and memory scanning
- Strong focus on injected code and runtime tampering visibility
- Used by: PUBG, Rainbow Six Siege, DayZ

### Vanguard (Riot Games)
- Boot-start kernel driver with early visibility into later-loaded drivers
- Boot-time initialization
- Driver allowlisting and aggressive system trust checks
- Used by: Valorant, League of Legends

### FACEIT AC
- Kernel-level competitive anti-cheat with strong process and driver monitoring
- Emphasis on platform integrity and low tolerance for hostile drivers
- Often discussed alongside Vanguard in kernel anti-cheat research

### Valve Anti-Cheat (VAC)
- User-mode detection
- Signature-based scanning
- Delayed ban waves
- Used by: CS2, Dota 2, TF2

### Other Systems
- **PunkBuster**: Legacy FPS anti-cheat
- **FairFight**: Server-side statistical analysis
- **nProtect GameGuard**: Korean anti-cheat solution
- **XIGNCODE3**: Mobile game protection
- **ACE (Tencent)**: Chinese market protection

## Detection Mechanisms

### Detection Decision Methodology

Use [`research-rigor`](../../research-rigor/SKILL.md) for source verification and
empirical validation. Numeric values elsewhere in this skill are examples or
research hypotheses unless they are tied to a representative, versioned
calibration study for the target game.

1. **Define the decision unit:** player, engagement, session, account, device,
   or build; state the game mode, patch, platform, input method, and timeframe.
2. **Establish telemetry trust:** record whether each field is server-observed,
   server-derived, client-reported, or reconstructed. Client reports are
   adversarial inputs; server authority improves trust but does not eliminate
   clock, replication, schema, or game-logic errors.
3. **Keep layers separate:** observation -> finding -> attribution -> action.
   A detector hit is not itself proof of cheating or actor intent.
4. **Calibrate locally:** derive features, sample floors, and operating
   thresholds from representative data. Hold out players/sessions and time
   periods; segment results by relevant populations.
5. **Measure deployment risk:** report prevalence, FPR, FNR, precision, recall,
   calibration, uncertainty, and the expected review volume. A score in
   `[0, 1]` is not a probability unless calibrated as one.
6. **Corroborate correctly:** combine causally distinct signals and evaluate
   their joint errors. Correlated signals, maximum-score aggregation, or a
   fixed signal count do not guarantee a lower false-positive rate.
7. **Review high-impact actions:** preserve counterevidence and an appeal path;
   use human review or independently trusted evidence before punitive action
   when false positives remain plausible.

For invariant findings, first verify that the invariant is guaranteed in the
observed state and exclude rollback, retry, reconnect, replication delay,
legitimate transitions, administrator/test paths, stale baselines, and game
bugs. Describe the result as a state-integrity violation until exploitation and
attribution are separately supported.

Every evidence package should retain the raw artifact or immutable reference,
timestamps and ordering, schema/game/detector versions, feature transforms,
threshold/model version, sample counts, provenance, contradictory evidence,
limitations, and the exact rule that fired.

### Memory Detection
```
- Code section hashing and integrity verification
- Executable private memory and manual-map detection
- Injected module and anomalous image mapping detection
- Memory modification and stack provenance monitoring
```

### Process Detection
```
- Handle access stripping and protected-process enforcement
- Thread start address, APC, and context inspection
- Debug register and hidden-thread monitoring
- Stack trace and module-correlation analysis
```

### Kernel-Level Detection
```
- Driver verification, signature policy, and blocklist checks
- Callback registration and object access monitoring
- System call, dispatch table, and hook integrity checks
- PatchGuard, test-signing, and kernel trust state checks
- Kernel pool scanning (Segment Heap aware) for hidden drivers and shellcode
```

### Kernel Pool Scanning (Segment Heap Era)
```
Why Segment Heap matters for anti-cheat:
Cheat drivers allocate memory in NonPagedPool for shellcode, hook tables,
hidden modules. The Segment Heap (19H1+) changed pool internals:
headers are HeapKey XOR encoded, allocation paths are split (kLFH, VS,
Segment, Large), metadata is isolated. Anti-cheat pool scanners must
understand these mechanisms to scan accurately without false positives.

Detection targets:

1. BigPool / Large Allocation scanning:
   - Walk nt!PoolBigPageTable (nt!PoolTrackTable)
   - Find allocations without corresponding DRIVER_OBJECT or loaded module
   - Detect manually mapped drivers that allocate large pool chunks
   - Large allocations have no inline header; metadata is external

2. VS Allocator chunk scanning:
   - Traverse _SEGMENT_HEAP → VsContext → SubsegmentList
   - Decode _HEAP_VS_CHUNK_HEADER using HeapKey:
     real_sizes = encoded_header ^ chunk_address ^ HeapKey
   - Check decoded chunk for suspicious PoolTag, executable content,
     or allocation without matching driver
   - VS chunks carry both _HEAP_VS_CHUNK_HEADER (encoded) and
     _POOL_HEADER (PoolTag still present)

3. kLFH bucket scanning:
   - _SEGMENT_HEAP → LfhContext → Buckets[] → AffinitySlots → Subsegments
   - kLFH randomizes block placement (harder to predict adjacency)
   - FreeHint encoded with LfhKey
   - Allocation pattern anomalies in specific size buckets can indicate
     pool grooming by cheat drivers

4. Suspicious PoolTag detection:
   - Cheat drivers use custom or rare tags; maintain blacklist
   - Cross-reference tags against known-good tag database (pooltag.txt)
   - Tags present in pool but absent from any loaded module = suspicious

5. Executable memory in NonPagedPool:
   - Find chunks with X permission but no corresponding module
   - Scan decoded chunk content for known cheat signatures, ROP gadgets,
     specific syscall stub patterns

6. Segment Heap integrity checks:
   - Validate the build-specific `_SEGMENT_HEAP` signature/layout using symbols
     and runtime checks (0xDDEEDDEE is observed on relevant layouts)
   - Verify VS chunk header encoding consistency
   - Detect tampered heap metadata (indicates heap exploitation attempt)

Required knowledge for scanner:
- nt!RtlpHpHeapGlobals (HeapKey, LfhKey) — obtained via pattern scan
- nt!ExpPoolQuotaCookie — for ProcessBilled decoding
- Per-pool-type _SEGMENT_HEAP instance addresses (nt!PoolVector)
- Allocation path determination (size → kLFH/VS/Segment/Large)

Anti-cheat KDP integration:
- Store detection rule tables in Secure Pool (ExAllocatePool3 + KDP)
- Correctly configured KDP can protect selected pages from ordinary VTL0 writes,
  including kernel R/W primitives, while the hypervisor and policy path remain
  trustworthy
```

### Behavioral Analysis
```
- Raw input timing and pattern analysis
- Movement and aim anomaly detection
- Statistical improbability and ML-assisted scoring
- Telemetry collection and server-side review
- AI visual aimbot detection (input pattern + gameplay behavior)
```

### AI Visual Aimbot Detection
```
AI visual cheats (screen capture + computer vision + hardware input) can be
among the harder classes to detect because some designs avoid game-memory
access, code injection, and a cheat driver on the gaming PC. Detection then
leans more heavily on trusted behavioral telemetry and contextual signals.

Input Pattern Analysis:
- Mouse movement micro-signature: a particular automation pipeline may retain
  acceleration or correction patterns distinguishable from a matched human
  baseline; this must be demonstrated rather than assumed
- Engagement timing: a given automation pipeline may produce a narrower
  latency distribution than a matched human baseline, but capture, inference,
  transport, smoothing, frame rate, and input hardware make absolute latency
  ranges setup-specific
- Quantization: a specific coordinate-to-HID conversion may leave repeated
  rounding patterns, but integer deltas also occur in legitimate input
- Correction patterns: some smoothing configurations produce repeated
  overshoot-and-settle shapes; compare them with matched legitimate behavior
- Target switching: an explicit automated scoring objective may produce more
  consistent ordering than a matched baseline, but implementations vary

Gameplay Behavioral Signals:
- Anomalous K/D ratio combined with other statistical outliers
- "Snap" engagement pattern: rapid crosshair movement to target
  followed by immediate fire, repeated consistently
- FOV-boundary effect: some configured systems produce a sharper engagement
  cutoff near a chosen radius; estimate it statistically and test alternatives
- Consistent headshot angle distribution that doesn't match
  the player's ranked skill bracket
- Engagement rate: compare visible-target engagement with a matched population;
  high or stable rates are contextual signals, not class rules

Environmental Detection:
- OBS Game Capture may load a graphics-capture hook into the game on supported
  paths; this is legitimate capture evidence, not cheat attribution
- Window/Display Capture backends vary across Windows Graphics Capture,
  BitBlt, Desktop Duplication, OBS version, and source settings
- Frame-transfer detection should account for shared GPU resources, reusable
  staging resources, readback, synchronization, and legitimate capture tools
- Known hardware input device USB VID/PID signatures
  (KMBox, certain Arduino/Teensy boards)
- USB device enumeration anomalies: input device appearing/changing
  mid-session
- Logitech driver version detection: known exploitable G HUB versions
- A known input-filter driver is a contextual signal; legitimate use and actual
  behavior must be established before assigning risk

Server-Side Statistical Analysis:
- Aim trajectory reconstruction from server-received input deltas
- Compare aim distribution against player population at same rank
- Detect systematic per-frame aim correction vectors
  that deviate from matched legitimate distributions
- Cross-session pattern analysis: test whether unusually stable metrics remain
  discriminative after controlling for skill, hardware, and play style
- Replay-based ML classifiers trained on confirmed AI aimbot cases

Anti-AI Countermeasures (Game Design):
- Evaluate ordinary gameplay effects, visual variety, and UI composition for
  model robustness without degrading accessibility or legitimate play
- Server-side aim validation: reject physically impossible aim transitions
- Treat model-targeted visual changes as experiments; adaptive models can
  retrain, and game-design costs may outweigh temporary detection gains
```

### Server-Side Replay Analysis for AI Aimbot Detection

Before interpreting trajectories or reaction time, use
[input measurement](input-provenance-and-measurement.md) and
[time, ordering and replay](../../game-server-security/references/time-ordering-and-replay.md).

```
Server-side detection can analyze gameplay and input telemetry without relying
on local process-scanning hits. It is a strong complementary layer against
zero-memory AI cheats when telemetry provenance and integrity are trustworthy;
client-uploaded fields remain untrusted until validated.

Input Telemetry Collection:
- Separate server-observed view/action state from uploaded client input
- For each field record origin, units, sample rate, aggregation and validation;
  server tick records alone do not establish raw-device or sub-tick coverage
- Record timestamps at the highest reliable precision supported by the input,
  engine, transport, and clock-synchronization pipeline
- Record crosshair angle / view angle per tick
- Record fire events with corresponding view angle at fire time
- Record damage events with hit location (head/body/limb)
- Collect per-session: total engagement count, hit count,
  headshot count, K/D, average engagement distance

Replay-Based Trajectory Reconstruction:
- Reconstruct only the sampled trajectory supported by recorded data;
  preserve missing intervals, transformations and interpolation uncertainty
- Overlay trajectory onto 3D game state (player positions, obstacles)
- Identify "engagement windows": trajectory segments where crosshair
  moves toward and locks onto a target
- Measure per-engagement: time-to-target, overshoot magnitude,
  correction count, final hold time before fire

Statistical Features for AI Detection:
  (extracted from reconstructed trajectories)

Temporal features:
- Reaction time distribution: time from target visibility to
  first crosshair movement toward target
  → Distinguish world, replicated, replay and displayed visibility;
    define the available observation point before measuring the interval
  → Compare automation and human distributions only within a matched,
    versioned setup; target-visibility definition, tick rate, latency, skill,
    and input method materially change the result
- Time-to-lock distribution: time from engagement start to
  crosshair on target
  → Compare matched distributions; consistency is a hypothesis to evaluate,
    not a universal distinction between automation and human behavior

Spatial features:
- Trajectory curvature: some smoothing algorithms produce repeated parametric
  shapes, but both automation and human trajectories vary by configuration,
  device, sensitivity, and task
- Overshoot-correction ratio: compare distributions within matched conditions;
  neither automation nor human behavior has a universal shape
- End-point precision: test for repeated offsets or concentration relative to a
  skill- and context-matched baseline
- Angular velocity profile: treat smoothness and acceleration as measured
  features, not class-defining rules

Engagement pattern features:
- Target selection consistency: automation configured with an explicit scoring
  objective may select targets more consistently than a matched human baseline;
  implementations need not use closest-to-crosshair or confidence ordering
- FOV boundary effect: measure boundary behavior in a declared coordinate
  space and context; there is no universal automated/human cutoff shape
- Engagement rate: measure against a defined visible-target denominator
  and matched task/skill/input context; consistency alone is not attribution
- Multi-target switching: compare timing and grouping against matched
  baselines; regularity is a candidate feature, not proof of automation
```

### ML Classifier for AI Aimbot Detection
```
Feature engineering and model architecture for detecting
AI-generated mouse input at scale.

Declare observed coordinate spaces, transformations and sampling/time bases.
Device-relative units, normalized absolute coordinates, viewport pixels and
view-angle degrees are distinct; pixel metrics require supported pixel data
or a documented conversion. See the input measurement reference above.

Feature Vector (per engagement window):
  f1:  reaction_time_ms
  f2:  time_to_lock_ms
  f3:  initial_angular_distance_deg
  f4:  trajectory_curvature_mean
  f5:  trajectory_curvature_std
  f6:  overshoot_magnitude (declared coordinate space and units)
  f7:  correction_count
  f8:  final_hold_time_ms
  f9:  angular_velocity_max_deg_per_sec
  f10: angular_velocity_std
  f11: micro_correction_rate (calibrated threshold, declared units/time base)
  f12: trajectory_straightness_ratio (distance / path_length)
  f13: dx_dy_correlation (Pearson correlation of delta components)
  f14: delta_magnitude_entropy (Shannon entropy of |delta| sequence)
  f15: fire_timing_relative_to_lock_ms

Session-level aggregate features:
  s1:  headshot_ratio
  s2:  hit_ratio
  s3:  reaction_time_cv (coefficient of variation across engagements)
  s4:  engagement_rate (targets engaged / targets visible)
  s5:  k/d_ratio
  s6:  fov_engagement_boundary_sharpness
  s7:  target_selection_optimality_score
  s8:  trajectory_curvature_consistency (inter-engagement variance)

Model architecture options:
- Gradient Boosted Trees (XGBoost/LightGBM):
  Strong candidate for tabular feature vectors, with fast inference and useful
  diagnostics; validate explanations and deployment fit
- Random Forest: useful baseline; overfitting depends on data and tuning
- 1D-CNN / LSTM on raw delta sequences:
  Operates on raw (dx, dy, dt) sequences instead of engineered features.
  Can capture patterns human engineers might miss.
  Higher compute cost; suitable for batch/offline analysis.
- Ensemble: combine tree-based features and sequence models only when held-out
  evaluation shows a worthwhile gain after calibration and complexity costs

Training data:
- Positive samples: confirmed AI aimbot users (manual review, honeypot,
  or controlled testing with known cheat software)
- Negative samples: legitimate high-skill players (important: include
  top-percentile players to avoid false-positives on skilled play)
- Hard negatives: players with aim-assist controllers (console),
  players using legitimate accessibility tools

Evaluation metrics:
- Choose an operating point from prevalence, error costs, enforcement policy,
  and review capacity; there is no universal acceptable FPR or TPR
- Report FPR, FNR, precision, recall, calibration and confidence intervals on
  representative held-out data, including population slices
- Session-level aggregation can reduce transient noise, but only after
  validating cross-session dependence, drift, and its effect on both FP and FN

Deployment pipeline:
  Client → input telemetry upload (per tick) → server telemetry DB
  → batch feature extraction (per engagement window)
  → ML inference (per session)
  → risk score aggregation (per player, across sessions)
  → threshold → manual review queue or automated action

Adversarial robustness:
- Cheat developers tune smoothing parameters to evade specific features
- Defense: retrain model periodically on newly confirmed samples
- Use feature combinations rather than single-feature thresholds
- Aggregate across sessions only after validating dependence, drift, and
  attacker adaptation
- Evaluate both raw-sequence and engineered-feature models adversarially;
  neither architecture is inherently harder to evade
```

### Hardware Input Device Detection
```
Detecting KMBox and similar hardware input injectors at the
platform/driver level.

USB Enumeration Signals:
- Known VID/PID combinations for KMBox, Arduino Leonardo (2341:8036),
  Teensy (16C0:0486), generic CH340/CP2102 serial adapters
- USB device appearing/disappearing during game session
- Multiple HID mouse devices where only one physical mouse is expected
- USB device with HID mouse capability but no manufacturer string
  or generic "Arduino LLC" / "Teensyduino" manufacturer

USB HID Report Analysis:
- Hardware input devices generate genuine HID reports, but:
  - Report rate: a simplistic injector may expose programmed periodicity, but
    real devices and sophisticated injectors can both show jitter
  - Report timing: some automation pipelines create burst patterns; human and
    legitimate software-assisted input can also be bursty
  - Delta distribution: compare against matched devices, polling rates,
    sensitivity, and movement tasks before drawing conclusions

Network Traffic Indicators (KMBox Net):
- KMBox Net uses UDP communication on the local network
- Packet pattern: consistent-size UDP packets at high frequency
  from a secondary device to the KMBox's IP
- Network evidence requires a collector that receives the relevant traffic.
  A shared LAN or public address alone provides neither visibility into every
  inter-device exchange nor evidence of prohibited use.

Driver-Level Detection:
- interception.sys: known driver signature, detectable via
  module enumeration and PiDDBCacheTable
- Logitech G HUB DLL injection: detect unexpected DLL loads
  into GHUB process, or specific exploitable GHUB versions
  via file version checking

Limitations:
- Protocol-conformant hardware injection may be indistinguishable from a normal
  mouse from an individual HID report alone; descriptors, timing, provenance,
  and gameplay behavior can still provide imperfect signals
- Device signatures can identify known implementations but are not durable
  attribution; statistical input analysis also requires calibration
- Dual-machine capture can avoid a cheat process on the gaming PC, but still
  leaves ordinary capture/input-device effects and may leave network or device
  telemetry depending on the design
```

## Anti-Cheat Architecture

### User-Mode Components
- Process scanner
- Module verifier
- Overlay detector
- Screenshot capture

### Kernel-Mode Components
- Driver loader
- Memory protection
- System callback registration
- Hypervisor and driver trust detection
- VAD and executable memory inspection

### Hypervisor-Level Components

Potential roles include CPU memory-permission enforcement and integrity evidence
for specifically protected regions. Identify the actual hypervisor integration,
policy owner, protected object/page lifetimes, and configuration interface.
Hypervisor presence does not establish that callback lists, telemetry structures,
or arbitrary third-party code are protected. DMA remapping is a separate path.
[Assurance boundaries](../../dma-attack/references/assurance-boundaries.md)

### Server-Side Components
- Statistical analysis
- Replay verification
- Report processing
- Ban management
