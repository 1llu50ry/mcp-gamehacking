---
name: behavior-ml-detector
description: Behavior-based (ML) cheat detection catalog -- VACnet (CS2), Overwatch 2 Watchdog, Fortnite Behavior Engine, Ricochet shadow-ban model.
type: tool-plugin
---

# Plugin: behavior-ml-detector

Catalog of server-side ML cheat detection systems.

## Entries

| System | Game | Features |
|---|---|---|
| VACnet 3.0 | CS2 | Angular velocity, pre-fire ratio, kill-cam consistency |
| Overwatch 2 Watchdog | OW2 | Aim track vs movement correlation, reaction-time variance |
| Fortnite Behavior Engine | Fortnite | Build pattern, aim target angular jerk, round-robin cadence |
| Ricochet shadow-ban | CoD MW/Warzone | Hit-reg anomalies, through-wall shot patterns |

## Research Vectors

- Humanize aim with jitter + Perlin noise ([[humanized-aim-jitter]]).
- Randomize reaction time (Gaussian, 180-300 ms).
- Rate-limit flicks (<= 1-2 per 10 s).

<!-- enriched:v2 -->
