---
name: hyperion-weekly-mutation-journal
description: "Hyperion / Byfron weekly handler-mutation journal — observed opcode shifts per week, dispatcher XOR rotation, how the research scene tracks drift."
metadata:
  type: reference
  source: curated
  topics: [hyperion, byfron, roblox, mutation, vm]
---
# Hyperion weekly mutation journal

Byfron (Hyperion) VM mutates per weekly Roblox client update. The community tracks drift because handler semantics stay mostly stable but opcode-to-handler mapping rolls.

## Observed per-week signals

- Dispatcher XOR key (byte): rotates 1 byte per week on known cadence.
- Handler table order: shuffled by a seed derived from the week-of-year.
- Occasional insertion of 1–2 opaque-predicate handlers that always resolve one way.
- Occasional removal of a seldom-used handler (e.g. a bit-shift-by-literal path replaced with a two-op sequence).

## Tracking method

- Snapshot last week's handler semantics via symbolic execution + Z3.
- Dump this week's handler bodies; cluster by basic-block hash.
- Match clusters pairwise; the unmatched remainder is the week's mutation.

## Related

[[hyperion-roblox-rev]], [[byfron]], [[angr-mcp]].
