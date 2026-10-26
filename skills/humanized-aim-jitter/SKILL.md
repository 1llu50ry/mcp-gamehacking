---
name: humanized-aim-jitter
description: "Humanized aim smoothing + jitter models -- cosine-tween, PID, Bezier curves, 2D jitter noise, timing noise, and how AC server-side detects non-human angular signatures."
metadata:
  type: tool-reference
  source: curated
  topics: [aimbot, humanization, pid, smoothing, behavioral-ac]
---
# Humanized Aim

Flick + track + settle. Three regimes:

- **Flick**: < 60 ms, high angular velocity.
- **Track**: continuous micro-adjust during follow-fire.
- **Settle**: sub-pixel corrections near target center.

## Models

- **Cosine-tween**: `theta(t) = theta_target * 0.5 * (1 - cos(pi * t / T))`.
- **PID**: proportional / integral / derivative on angular error.
- **Bezier**: cubic Bezier through 4 control points for curved aim path.
- **Jitter noise**: 2D Perlin or Gaussian noise summed into target position.
- **Timing noise**: Gaussian jitter on `dt` to avoid 240 Hz-locked angular velocities.

## Detection vectors (what to avoid)

- Zero-time snap (angular jerk delta spike).
- Monotonic monotonic angular velocity (no micro-oscillation).
- Perfectly aligned Nyquist-locked cadence.

## Related

[[yolo-aim-pipeline]], the `cheat-developer` agent, `detection-assessor` subagent.
