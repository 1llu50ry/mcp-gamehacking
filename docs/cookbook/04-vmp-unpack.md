# Recipe 4 — VMProtect unpack with YARA + x64dbg

**Goal:** detect VMP, break at OEP, dump the unpacked image, decrypt
embedded strings, and hand the clean binary to Ghidra.

## Pieces

- `yara_scan` (`src/native-yara.ts`) — balanced-brace rule parser
- `plugins-side/x64dbg/mcp_bridge.cpp` — port 48765
- `smart_decompile` — final fail-over to Ghidra

## Rule to detect VMP

```yara
rule vmprotect_3x {
    meta: author = "mcp-gamehacking"
    strings:
        $vmp_sig = { 68 ?? ?? ?? ?? E8 00 00 00 00 83 04 24 ?? C3 }
        $vmp_sec = ".vmp0" ascii
    condition: all of them
}
```

Scan a sample:

```jsonc
{ "name": "yara_scan", "arguments": {
    "sample": "protected.exe",
    "rulesPath": "./rules/vmp.yar"
}}
// → [{"rule":"vmprotect_3x","matches":[…]}]
```

## Break at OEP with x64dbg

Attach via the bridge:

```jsonc
{ "name": "x64dbg_run", "arguments": {
    "cmd": "init protected.exe; bp 0x40A1B2; run"
}}
```

When the breakpoint hits, dump:

```jsonc
{ "name": "x64dbg_run", "arguments": {
    "cmd": "savedata unpacked.bin, 0x400000, 0x100000"
}}
```

## Rebuild the PE

```jsonc
{ "name": "pe_debug_dir", "arguments": { "path": "unpacked.bin" }}
// → section layout, Rich header, debug dir — all native, no external deps

{ "name": "pattern_mine", "arguments": {
    "path": "unpacked.bin",
    "pattern": "68 ?? ?? ?? ?? E8"
}}
// find leftover VMP stubs to NOP out
```

## Hand off to Ghidra for analysis

```jsonc
{ "name": "smart_decompile", "arguments": {
    "sample": "unpacked.bin",
    "addr": "0x40A1B2"
}}
```

## When to use

Any time the input is packed and the LLM would otherwise ask you to
"please provide the unpacked binary" — this gives it a real pipeline
to unpack things itself.
