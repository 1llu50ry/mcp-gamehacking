---
name: vmprotect-dumper-c
description: "VMProtect dumper — a single-file C unpacker (~4,200 LOC, gcc -O2 -s -static) that attaches to a VMP-protected process, waits for the OEP, dumps every section, reconstructs the IAT, scans for dropped files, and zips the result. Includes a Memory Harvester v5.0 submodule that watches for dynamically-allocated regions and dumps them on activity bursts."
metadata:
  type: reference
  source: curated
  topics: [vmprotect, unpacker, oep, iat-rebuild, memory-harvester, dumper, pe-sieve]
---

# VMProtect Dumper (single-file C)

Standalone x86 / x64 unpacker for VMProtect-protected PE binaries. Build:

```
gcc -O2 -s -static -o vmprotect_dumper_x64.exe VMProtectDumper.c
```

~4,200 lines, no runtime deps beyond kernel32 / ntdll. One self-contained TU.

## Pipeline

1. **Attach** — `OpenProcess` + `detect_target_architecture_vmp()` resolves image base via NtQueryInformationProcess(ProcessBasicInformation) + PEB walk.
2. **Section snapshot** — reads original PE section table, hashes each section (`FINGERPRINT_SIZE=64` bytes). Later rounds compare to detect "section just got rewritten" — classic signal that the VMProtect bootstrap finished unpacking.
3. **OEP capture** — polls main thread CONTEXT every `POLL_INTERVAL_MS=50`. When RIP lands outside the known `.vmp0` / `.vmp1` sections AND inside what was originally `.text`, this is the OEP. CRT prologue heuristics (`scan_crt_pattern`) raise confidence.
4. **Full image dump** (`dump_full_image`) — walks the loaded image via `ReadProcessMemory`, rebuilds the PE on disk with corrected `SizeOfImage` and the real section headers.
5. **IAT reconstruction** — three-stage:
   - `scan_for_iat_entries` locates thunk tables near the OEP's import call sites.
   - `resolve_iat_thunks` maps each unresolved thunk to a `(module, ordinal_or_name)` by probing every pointer against `GetModuleHandle`/`GetProcAddress`.
   - `rebuild_iat` emits a fresh import directory + IAT in the dumped PE.
6. **Metadata** (`write_dump_metadata`) — JSON manifest with per-section hashes, OEP, pre-/post-unpack sizes, dumper version.
7. **Harvest side-channel** — the Memory Harvester v5.0 submodule watches for dynamically-allocated RWX regions (via a cumulative union of VAD snapshots) and dumps them when ≥ `HARVEST_REGION_THRESHOLD=3` new ones appear within `HARVEST_SETTLE_MS=3000` ms. Catches stage-2 blobs VMProtect allocates but never commits to the PE.
8. **Drop capture** (`capture_dropped_files`) — watches `MAX_WATCH_DIRS_FWD=16` directories (temp, cwd, parent) for new PE files written while the target runs.
9. **String scan** (`scan_process_strings`) — ASCII + UTF-16LE sweep over the final image for triage.
10. **PE-sieve integration** (`detect_pesieve_path`) — if PE-sieve is on PATH, runs it against the live process with `PESIEVE_TIMEOUT_MS=60000` to cross-validate.
11. **Zip + password** (`create_password_zip`) — bundles everything into a password-protected archive so the sample doesn't accidentally detonate on the triager's host.

## Why this architecture is good

- **Single file, static build** — drops cleanly on any Windows triage box; no DLL hell.
- **Harvester + section fingerprint combo** — survives VMProtect variants that unpack in multiple waves (`Ultra`, `UltraCustom`). Pure section-fingerprint approaches miss stage-2 blobs; pure harvester misses the main image.
- **OEP by RIP-outside-sections heuristic** — simpler than tracking VM dispatcher state, works for stock VMProtect without devirtualisation.

## Known limitations

- Pure VMProtect; Themida variants need their own entry-point heuristic.
- Full devirtualisation of mutated functions is out of scope — this is a *dumper*, not a devirtualiser. Pair with [[vmp-devirt-pipeline]] for that layer.
- Zip password is build-constant; swap it per deploy before shipping.

## Related

Pairs with [[vmprotect-sdk-usage]] (how the SDK leaves markers on the way in), [[vmp-devirt-pipeline]] (what to do with the dumped VM handlers), [[themida-oreans-vm]] (sister problem), [[angr-mcp]] (symbolic cleanup of dumped function bodies).
