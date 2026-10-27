---
name: cs2-vacnet-3-inside
description: "CS2 VACnet 3.0 server-side detection model -- behavioural features it uses, demo pipeline, kick/ban cadence, dodging strategies for research."
metadata:
  type: reference
  source: curated
  topics: [cs2, vacnet, valve, behavioural-ac]
---
# CS2 VACnet 3.0

Valve's server-side ML cheat detector for CS2. Lives on Steam Datagram Relay edges. Runs on captured demo chunks (~every N rounds), not live telemetry, which makes individual-round evasion possible but ban-wave evasion hard.

## Features VACnet 3.0 watches

- Angular velocity jerk at pre-fire events.
- Pre-fire ratio (shots landed vs. not-yet-visible targets).
- Flick angle variance vs. baseline per-session.
- Micro-correction cadence (sub-degree re-aim within the 50 ms before kill).
- Visibility-gated hit-reg (kills through smoke / wallbangs disproportionate to sample).

## Known cadence

- Chunks uploaded to Valve for scoring every few rounds; bans applied in weekly waves (Thursday US morning).
- Shadow-flag → wave-ban model, not instant kick.

## Related

[[behavior-ml-detector]], [[humanized-aim-jitter]], [[cs2-specialist]].
