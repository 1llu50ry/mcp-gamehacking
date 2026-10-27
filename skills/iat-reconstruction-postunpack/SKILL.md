---
name: iat-reconstruction-postunpack
description: "Three-stage IAT reconstruction after a packer unpacks — scan for thunk tables near the OEP's call sites, resolve each thunk to (module, ordinal_or_name) by probing GetModuleHandle / GetProcAddress, rebuild a fresh import directory in the dumped PE."
topics: [iat, imports, unpacker, scylla, vmprotect, themida]
metadata:
  type: reference
  source: curated
  topics: [iat, imports, unpacker, scylla, vmprotect, themida]
---

# IAT reconstruction post-unpack

After the packer unpacks and the OEP fires ([[oep-capture-memory-harvester]]), the dumped PE has the correct `.text` but the import directory is still packer-encrypted or missing. Three steps rebuild it.

## Stage 1 — Scan for thunk tables (`scan_for_iat_entries`)

Walk `.text` near the OEP looking for indirect call sites:

```
FF 15 ?? ?? ?? ??   call  qword ptr [rip+disp32]
FF 25 ?? ?? ?? ??   jmp   qword ptr [rip+disp32]
```

Each `disp32` points at a thunk slot. Group adjacent slots → candidate thunk tables (typical IAT layout: 4-byte or 8-byte aligned, contiguous, each slot pointing to an executable address in `kernel32 / user32 / ntdll / vcruntime`).

Keep up to `MAX_IAT_SLOTS = 8192` candidates. Each candidate: `{ rva, pointer_value, suspected_module }`.

## Stage 2 — Resolve thunks (`resolve_iat_thunks`)

For each candidate pointer:

1. Which module owns it? `GetModuleFileNameEx` on `(hProc, pointer)` → module path.
2. What's the export it maps to? Walk the owner module's export directory, binary-search the ordered RVA list, hit the entry whose RVA equals `pointer - module_base`.
3. Resolve to `(name, ordinal)`.
4. Fallback: `GetProcAddress(module, ordinal)` and `GetProcAddress(module, forwarded_name)` to catch forwarder chains (`AdvAPI32 → ntdll`).

Common failure modes:

- Forwarded exports (`AdvAPI32.RegOpenKeyExA → ntdll.RtlRegOpenKeyExA`) — resolve the forward recursively.
- Delay-loaded imports (`LoadLibrary` + `GetProcAddress` at runtime) — these aren't in the real IAT; emit them to a side-channel manifest instead.
- Packer-planted trampolines — the pointer lands in a packer-allocated RWX region, not a module. Follow one `jmp` + re-resolve; if still unresolved, flag.

## Stage 3 — Rebuild (`rebuild_iat`)

Emit a new `.idata`-shaped section:

- `IMAGE_IMPORT_DESCRIPTOR` array (one per module, terminator = zeroes).
- For each module: `OriginalFirstThunk` (name hints), `FirstThunk` (patched IAT), ASCII name string.
- `IMAGE_THUNK_DATA64` entries: either `IMAGE_ORDINAL_FLAG64 | ordinal` or RVA of `IMAGE_IMPORT_BY_NAME`.

Update the PE's data directory #1 to point at the new table. Clear any residual VMProtect import-protection stub.

## Validation

Round-trip with Scylla ([[scylla-mcp]]) to cross-check: load the dumped PE, re-run Scylla's IAT scan, compare. Agreement rate on clean VMProtect dumps is usually > 95% — the disagreements are the delay-loaded ones.

## Related

Pairs with [[vmprotect-dumper-c]] (which runs this exact pipeline), [[oep-capture-memory-harvester]] (what feeds it), [[scylla-mcp]] (cross-validation), [[import-resolver]] subagent (same job inside a running loader).
