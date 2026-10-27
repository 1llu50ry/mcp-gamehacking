---
name: twitch-streamer-mode-detect
description: "Twitch 'streamer mode' / OBS co-presence detection — how AC vendors detect capture + stream mode, false-positive sources, tooling to measure."
metadata:
  type: reference
  source: curated
  topics: [twitch, obs, streamer-mode, capture]
---
# Twitch streamer-mode detection

Anti-cheat vendors increasingly stricter around 'is this user streaming or recording'. Pure negative detection (no OBS process) is unreliable because viewers close OBS mid-match.

## Signals

- OBS process present (`obs64.exe` / `OBS Studio.exe`).
- OBS Virtual Camera driver (`obs-virtualcam.dll`) loaded.
- DXGI Desktop Duplication consumer other than the explorer shell.
- WASAPI loopback capture active.
- Twitch desktop app (`Twitch Studio`, `Streamlabs`) presence.
- NVIDIA ShadowPlay / AMD ReLive overlay hook.

## False positives (why you can't just block streaming)

- Discord screenshare uses the same DXGI DD path.
- NVIDIA GeForce Experience Highlights.
- GameBar DVR.

## Related

[[anti-screenshot]], [[obs-plugin-dev]].
