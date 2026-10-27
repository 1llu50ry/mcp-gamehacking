---
name: dotnet-protection-stack
description: ".NET / C# protection pipeline — anti-dumping, anti-tamper EOF, calli-based call hiding, control-flow flattening, fake custom attributes, method-body padding, random helper methods, stack-unflatten confusion, watermarking."
metadata:
  type: reference
  source: curated
  topics: [dotnet, csharp, dnspy, protection, cflow, anti-tamper]
---
# .NET / C# protection stack

Small-but-thorough .NET protection kit (observed in the wild, 14 modules):

| Module | Purpose |
|---|---|
| `AntiDumping` | Memory flag flip + poison PE header post-start so a `dnSpy` dump sees garbage |
| `AntiTamperEOF` | Appends a signed EOF payload; CLR init validates; patched binary fails to JIT |
| `Calli` | Replaces direct method calls with `calli` indirect through a pre-resolved token |
| `ControlFlowFlattering` | Dispatcher-based CFG flattening of each method body |
| `FakeAttributes` | Plants custom-attribute classes that fool decompilers' heuristics |
| `InjectHelper` | Harness to load the protected assembly into the host AppDomain |
| `MethodBodyPadding` | Inserts dead nops / junk IL so method size does not reveal real body |
| `RandomMethods` | Generates N random helper methods per build to defeat signature-based tracking |
| `StackUnfConfusion` | Mangles `ldloc` / `stloc` sequences into equivalent stack-shuffle patterns |
| `Watermark` | Build-stamp signature per customer (anti-leak) |

## Why it matters

- Baseline against dnSpyEx / ILSpy / dotPeek. Each of these modules forces the analyst into one extra pass before the real logic is readable.
- Known weakness: all are static; dynamic deobfuscation (`clrmd-mcp` live heap walk) sees through most.

## Related

[[dotnet-reverse]], [[dnspy-mcp]], [[clrmd-mcp]], [[control-flow-flattening]].
