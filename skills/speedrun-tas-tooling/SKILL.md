---
name: speedrun-tas-tooling
description: "Speedrun / TAS tooling -- BizHawk, libTAS, LiveSplit integration, frame-perfect input playback, segment timing."
metadata:
  type: tool-reference
  source: curated
  topics: [tas, speedrun, bizhawk, libtas, livesplit]
---
# Speedrun / TAS Tooling

TAS = Tool-Assisted Speedrun. Produces a frame-by-frame input script replayed deterministically.

## Tooling
- **BizHawk**: multi-system TAS platform (NES/SNES/N64/GBA/PSX...). Lua scripting.
- **libTAS**: Linux Steam games.
- **LiveSplit**: real-time segment timer; HTTP server for integration.

## Integration opportunities
- Hook LiveSplit's HTTP endpoint to auto-split via memory read.
- Dolphin + libTAS for GCN/Wii TAS pre-record.

## Related
Pairs with the `speedrun-tooling-researcher` agent.
