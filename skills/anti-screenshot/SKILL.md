---
name: anti-screenshot
description: "Anti-screenshot techniques used by anti-cheat (FACEIT, Vanguard, EAC) -- what gets uploaded, when, and defensive bypass (desktop duplication neuter, GPU-side masking)."
metadata:
  type: tool-reference
  source: curated
  topics: [anti-screenshot, faceit, overlay, capture, ac-telemetry]
---
# Anti-Screenshot

AC vendors periodically capture a screenshot for review. Captures the primary monitor at `swapchain->Present` time.

## Known cadence

- FACEIT: every ~2 minutes mid-match + MVP display.
- Vanguard: on-demand (anti-cheat flag) + match-start.
- EAC: random, lightweight -- shipped off to Epic reviewers.

## Vectors against

- **Overlay side-channel**: push the overlay to a *second* swap chain / separate window / shader-only layer that the AC capture call doesn't see.
- **Desktop duplication** interception -- AC uses DXGI DesktopDuplication; a kernel-level hook of `DwmGetWindowAttribute` / `IDXGIOutputDuplication` can present the clean frame.
- **GPU-side masking** -- feed the overlay into a compute pass that executes after the AC capture tap.

## Related

[[anti-screenshot-capture]], the `rendering/screen-capture-reference` plugin, `cheat-developer` agent.
