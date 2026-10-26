---
name: il2cpp-string-decrypt
description: "Unity IL2CPP string literal recovery when global-metadata.dat is encrypted (common in Unity 2022+ Mihoyo, miHoYo, Tencent games). Techniques for unpacking in-memory + patching."
metadata:
  type: tool-reference
  source: curated
  topics: [unity, il2cpp, metadata, encryption, mihoyo]
---
# IL2CPP String Decryption

Unity 2022+ games sometimes ship an encrypted `global-metadata.dat`. The decryption key is derived at startup from the shipped libil2cpp binary.

## Attack

1. Breakpoint on `fopen("global-metadata.dat", ...)` and immediate return value.
2. In-mem dump the file after decryption (RW page allocated near the libil2cpp .data section).
3. Pair with the `Il2CppDumper` tool to emit `DummyDll` + `script.json`.

## Known games

- Genshin Impact / Honkai Star Rail (miHoYo) -- custom AES, key derived from device + build.
- CODM / PUBG Mobile (Tencent) -- XOR-rolled with per-session seed.

## Related

[[il-analyzer]], [[il2cpp-dumper]], the `unity-specialist` agent.
