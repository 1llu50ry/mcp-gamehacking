---
name: unity-mihoyo-gi-rev
description: "Genshin Impact / HSR miHoYo client reverse engineering -- Unity IL2CPP + mhyprot driver + encrypted metadata + rolling anti-cheat updates."
metadata:
  type: tool-reference
  source: curated
  topics: [genshin, mihoyo, hoyoverse, unity, mhyprot, il2cpp]
---
# Genshin Impact / HSR Reverse Engineering

miHoYo (HoYoverse) Unity-based titles. Protection chain:

- `mhypbase.dll` -- userland anti-tamper.
- `mhyprot2.sys` / `mhyprot3.sys` -- kernel driver (mhyprot2 is a BYOVD vector).
- IL2CPP w/ encrypted global-metadata.dat.
- Server-side telemetry + anomaly detection.

## RE approach

1. Dump `global-metadata.dat` post-decryption (`il2cpp-string-decrypt`).
2. Run `Il2CppDumper` with the dumped metadata + `GameAssembly.dll`.
3. Resolve runtime offsets via SDK gen; patch via Mono-like `MethodInfo->methodPointer` swap.
4. For kernel driver: `mhyprot2` is signed and classic BYOVD (arbitrary KM r/w via IOCTL).

## Related

[[mhyprot]], [[mhyprot-byovd]], [[il2cpp-string-decrypt]], the `unity-specialist` agent.
