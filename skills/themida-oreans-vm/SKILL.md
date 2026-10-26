---
name: themida-oreans-vm
description: "Themida / Oreans Code Virtualizer VM internals -- handler layout, mutation engine, FishHunter aid, lifter state of the art."
metadata:
  type: tool-reference
  source: curated
  topics: [themida, oreans, vm-protection, fishhunter, code-virtualizer]
---
# Themida / Oreans Code Virtualizer

Oreans ships Themida (whole-binary) and Code Virtualizer (per-function). Both share a handler-based VM.

## Variants

- **Classic**: shared handler table across a module. Easier to cluster.
- **Fish**: handler mutation per instance; defeats static clustering.
- **CV-FFP**: finite-field-permuted dispatcher; adds algebraic obscurity.

## Known lifters

- `ThemidaDie` (defunct)
- `FishHunter` (defunct) -- but writeups survive
- Custom VTIL plug-ins for research
- Pint (experimental for Themida 3.1.5+)

## Signals

- PE sections `.themida`, `.winlice`, `.boot`.
- Thread-local VM state buffer, pointer kept in `fs:[0]` chain.

## Related

[[vmp-devirt-pipeline]], [[angr-mcp]], the `obfuscation-analyst` agent.
