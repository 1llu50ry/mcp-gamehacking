---
name: protection-techniques-reference
description: Catalog of software-protection + anti-RE techniques — VM-based protectors (OSS + commercial), control-flow flattening, anti-DSE / anti-SE, compile-time string hiding, IAT hiding, anti-dumping, licensing primitives, disassembly desync, and capture-detect bypass.
type: tool-plugin
---

# Plugin: protection-techniques-reference

Cross-reference for every protection / anti-RE technique the library documents in depth. Use it in parallel with its mirror [[anti-cheat-timeline]] — one shows "how to protect your binary", the other shows "how an AC detects your binary".

## Technique matrix

| Family | Technique | Depth skill |
|---|---|---|
| VM-based protector (OSS) | EagleVM playground | [[eaglevm-protector]] |
| VM-based protector (commercial) | VMProtect SDK markers + devirt pipeline | [[vmprotect-sdk-usage]] / [[vmp-devirt-pipeline]] |
| VM-based protector (commercial) | Themida / Oreans CV | [[themida-oreans-vm]] |
| CFG / anti-DSE | Flattening + opaque predicates | [[antidse-crystallguard]] / [[control-flow-flattening]] |
| CFG | Disassembly desync | [[disasm-desync-jump-target]] / [[anti-disassembly-techniques]] |
| String hiding | AVX / AES-NI XOR literal | [[xorstr-avx-aesni]] / [[data-obfuscation-xorstr]] |
| String hiding | Single-header C obfuscator | [[obfusk-single-header-c]] |
| IAT hiding | PEB-walk hash resolver (Bellum) | [[antidse-crystallguard]] |
| .NET | Full anti-dump / tamper / cflow stack | [[dotnet-protection-stack]] |
| Native-JVM | DefineClass runtime obfuscation | [[jvm-native-obfuscation]] |
| Capture-detect bypass | NVIDIA ShadowPlay | [[nvidia-shadowplay-bypass]] |
| Capture-detect bypass | AMD AMF / ReLive | [[amd-stream-proof]] |
| Forensics evasion | Prefetch minifilter | [[prefetch-kernel-hook-filter]] |
| Licensing | TPM EK binding | [[tpm-license-checker]] |
| Licensing | Anti-skid canary / watermark | [[anti-skid-techniques]] |

## Choosing a technique

- **Cheat-dev shelf-life maximisation**: VMProtect + xorstr + anti-DSE + TPM license. Weeks of analyst time per build.
- **One-click OSS protection**: obfus.h single-header. Entry level; defeats skids but not professional analysts.
- **.NET**: full dotnet-protection-stack baseline + CryptoObfuscator / Eazfuscator for commercial. Dynamic analysis via ClrMD still pierces most.
- **Anti-DSE priority**: opaque predicates + context pollution. Target Triton and angr specifically.

## Related

Pairs with the `protection-engineer` agent + `obfuscation-analyst` agent (the two sides of the fence).

<!-- enriched:v2 -->
