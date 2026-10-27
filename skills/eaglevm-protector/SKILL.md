---
name: eaglevm-protector
description: "EagleVM (GPLv3) — OSS x64 VM-based protector by Evian-Zhang. Playground for virtualising assembly; teaches handler-table design, VMenter/VMexit, register state packing. Great starting point for understanding modern commercial protectors (VMProtect / Themida) by seeing an OSS cousin."
metadata:
  type: reference
  source: curated
  topics: [eaglevm, vm-protector, x64, gpl3, virtualization]
---
# EagleVM

Open-source x64 VM-based protector. `Playground for generating virtual machine protected x64 assembly.` GPLv3.

## What you learn by reading it

- Handler-table dispatch (fetch opcode → index → execute handler → next).
- VM register state packed in a per-thread struct; saved/restored on VMenter/VMexit.
- Stub insertion that re-points the entry point of each protected function to the VM dispatcher.
- Sandbox + core separation: `EagleVM.Core` builds the IR, `EagleVM.Sandbox` runs test cases, `EagleVM.Stub` ships at target-time.

## Why it matters

- Commercial protectors (VMProtect, Themida) are the same shape with secret handler sets. Understanding EagleVM's handler layout is the fastest way into how VMProtect devirtualization pipelines ([[vmp-devirt-pipeline]]) actually work.
- OSS → modifiable → you can emit instrumented handlers for RE research.

## Repo

[Evian-Zhang/EagleVM](https://github.com/Evian-Zhang/EagleVM). License GPLv3 — reuse must stay GPLv3.

## Related

[[vmp-devirt-pipeline]], [[themida-oreans-vm]], [[angr-mcp]], the `obfuscation-analyst` agent.
