---
name: oep-capture-memory-harvester
description: "Generic OEP capture + Memory Harvester pattern for unpacking any multi-stage packer (VMProtect / Themida / Enigma / Obsidium). Watches thread RIP against the original section table, flags OEP when execution lands outside the packer sections, and simultaneously harvests dynamically-allocated regions to catch stage-2 blobs that never land in the main PE."
metadata:
  type: reference
  source: curated
  topics: [oep, unpacker, memory-harvester, packer, dynamic-regions, pe-sieve]
---

# OEP capture + Memory Harvester pattern

Reusable architecture for a packer-dumper. Works against VMProtect, Themida, Enigma, Obsidium, UPX-variants — anything that unpacks in ≥ 2 stages.

## Primitives

### Section fingerprint table

```c
typedef struct {
    char   name[16];
    DWORD  rva, vsize, raw_size, characteristics;
    BYTE   fingerprint[64];     // sha1 or truncated sha256 of initial content
    int    changed;             // flipped when fingerprint moves
    int    was_zeroed;
    int    nz_bytes;
} SectionInfo;
```

Snapshot pre-run, re-hash each poll (`POLL_INTERVAL_MS = 50`). Transitions you care about:

- `was_zeroed == 1 → nz_bytes > 0` : a stage dumped bytes into a previously-empty section.
- `fingerprint changed` : something rewrote this section (classic VMP tail-stage).

### OEP heuristic (no symbolic exec)

1. `SuspendThread` → `GetThreadContext` → read RIP.
2. If RIP is inside any `*.vmp*` / `.enigma*` / `.themida*` section → still in bootstrap.
3. If RIP is inside what the *original* `.text` section used to be → candidate OEP.
4. Boost confidence with `scan_crt_pattern`: looks for `48 83 EC 28 E8 ?? ?? ?? ??` (standard x64 `__security_init_cookie` prologue) within `OEP_SCAN_SIZE = 4096` of RIP.
5. On hit → freeze thread, trigger full dump.

### Memory Harvester

Independent polling thread (`HARVEST_SNAP_INTERVAL = 500 ms`, `HARVEST_BEHAV_INTERVAL = 2 s`). Walks VAD via `NtQueryVirtualMemory(MemoryBasicInformation)`, keeps a *cumulative union* of every RWX region observed since start.

Trigger condition:

- ≥ `HARVEST_REGION_THRESHOLD = 3` *new* regions since last tick, AND
- `HARVEST_SETTLE_MS = 3000` ms passed since the first of them (lets the packer finish writing).

On trigger: dump every region to disk as a numbered blob plus a JSON manifest with `(address, size, protect, first_seen_tick, fingerprint)`.

### Dropped-file watcher

Watches `MAX_WATCH_DIRS_FWD = 16` directories (temp, cwd, parent, ProgramData, user Downloads) via `ReadDirectoryChangesW`. Captures every new PE written while the target is live.

### PE-sieve cross-check

Shell out to [`pe-sieve`](https://github.com/hasherezade/pe-sieve) with `PESIEVE_TIMEOUT_MS = 60000`. If the OEP heuristic missed and pe-sieve catches an injection, you get a safety net.

## Why this works where simpler dumpers don't

- Single-stage dumpers (`ReadProcessMemory` the whole image at a fixed timeout) miss stage-2 blobs that never commit to the PE sections.
- Pure harvesters miss the main image.
- Pure OEP-chasers (ScyllaHide / Scylla) don't follow dynamic regions.
- Combining the three closes 90% of what VMProtect / Themida 3.x can hide.

## Known failure modes

- Stage-rolled packers that re-encrypt during normal execution: the fingerprint flips periodically and triggers false dumps. Fix with a settle timer that requires stable fingerprints for `≥ 10 s` before dumping.
- Harvester trips on legitimate JIT (V8 in Electron, CLR). Allow-list `coreclr.dll` / `v8.dll` addresses.

## Related

[[vmprotect-dumper-c]] implements this exact architecture end-to-end. Pair with [[themida-oreans-vm]], [[vmp-devirt-pipeline]], [[protondrm-game-protection]], [[scylla-mcp]].
