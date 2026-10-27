---
name: obfusk-single-header-c
description: "obfus.h / Obfusk (by DosX) — single-header C obfuscator. Control-flow flattening, dynamic anti-debug, fake protector signatures (Themida / VMProtect fingerprints), string encryption, all in one include. Build-time only."
metadata:
  type: reference
  source: curated
  topics: [obfusk, obfus.h, dosx, control-flow, antidebug, fake-signatures]
---
# obfus.h (Obfusk)

Single-header C obfuscator. One `#include` + a few macros and your TU is protected.

## Build flags (observed in header)

- `OBFH_SEED` — 32-bit build seed; same seed → stable output.
- `OBFH_BETTER_CONTROL_FLOW` — stronger CFG flattening (slower codegen).
- `OBFH_BETTER_ANTIDEBUG` — dynamic anti-debug with multiple canaries.
- `OBFH_FAKE_SIGNATURES` — plants Themida / VMProtect / Enigma fingerprints to misdirect analysts (PEiD-style).
- `OBFH_DISABLE_CONTROL_FLOW` — opt out of CFG flattening per TU.

## Why cheats and malware use it

- Zero build-system cost (header-only).
- Fake-signature misdirection makes YARA / DIE / Exeinfo lie — triage looks confident but wrong.
- Mid-tier protection; serious RE pierces it fast, but ratios enough viewers out to be worth it.

## Detection pointers

- Fake sigs land at predictable offsets; cross-check with the real Rich Header via [[rich_header_parse]]. Mismatch between claimed packer and MSVC build date = Obfusk fake.
- Anti-debug canaries live in a small region; find one, enumerate siblings.

## Related

[[themida-oreans-vm]], [[vmp-analyzer]], [[control-flow-flattening]], [[anti-disassembly-techniques]].
