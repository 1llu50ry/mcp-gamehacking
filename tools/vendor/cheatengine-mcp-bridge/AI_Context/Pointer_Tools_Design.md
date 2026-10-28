# Design: Pointer Walk-back Tools (UNIT-24)

**Status:** ✅ Implemented (UNIT-24)
**Target:** bridge v12.x · wire `_v99`
**Adds:** 2 MCP tools — `analyze_pointer_access`, `validate_pointer_chains`

---

## 1. MOTIVATION

The hardest part of building a cheat table is **finding a stable pointer path** to a dynamic value. The current AI workflow gets stuck at one step:

1. Find the address of value X with `scan_all` / `next_scan`. ✅ (already supported)
2. Find a pointer map to X. ❌ **stuck** — CE's pointer scanner yields thousands of candidates, and `pointer_rescan` only pops CE's GUI window (returns `-1`).
3. As a workaround, the agent writes auto-assembler logging scripts — expensive and indirect.

The bottleneck is **candidate triage**, not memory access. Everything except pointer scanning is already programmatic. These two tools attack the triage directly, reusing existing primitives, and follow the project's thin-handler philosophy: the agent orchestrates the loop; each tool does one well-bounded job.

---

## 2. SCOPE

### In scope
- `analyze_pointer_access` — turn one captured memory access (instruction + register snapshot) into the structural facts needed to climb **one** level of a pointer chain.
- `validate_pointer_chains` — batch-resolve candidate chains against a known address and report which currently hit it (re-runnable after a restart to find *stable* chains).

### Out of scope (YAGNI)
- A full programmatic pointer scanner (`pointer_scan_to`). The agent reproduces it by composing `analyze_pointer_access` → `scan_all` → recurse. Revisit only if composition proves insufficient.
- Module-range detection inside `analyze_pointer_access`. The tool stays pure; the agent resolves module membership of a base with the existing `get_address_info`.
- Value-based matching in `validate_pointer_chains`. Matching is on **final address** only (the address where the value lives).

---

## 3. TOOL 1 — `analyze_pointer_access`

**Purpose:** Convert a single captured access into "the value is at `[base_register] + displacement`," giving the agent the next address to scan for. **Pure logic — no CE API calls**, so it is unit-testable offline (the operand parser is the only risky part).

### Inputs
| Param | Type | Req | Notes |
|-------|------|-----|-------|
| `instruction` | str | ✅ | The accessing instruction, e.g. `"mov [rcx+04],eax"`. Exactly the string `poll_dbvm_watch` / `get_breakpoint_hits` return. |
| `registers` | object | ✅ | Register → value map (hex string or int), e.g. `{"RCX":"0x1F2A0"}`. As returned by the hit logs. |
| `accessed_address` | str | — | The faulting address if already known (DBVM watches know it). Used to cross-check / disambiguate. |
| `is_64bit` | bool | — | If provided, sets the suggested `scan_type` in the output. |

### Output
```json
{
  "success": true,
  "access_type": "register_indirect",
  "base_register": "RCX",
  "index_register": null,
  "scale": null,
  "displacement": 4,
  "hex_displacement": "+0x4",
  "struct_base": "0x1F2A0",
  "accessed_address": "0x1F2A4",
  "next_scan_value": "0x1F2A0",
  "scan_type": "qword",
  "is_static": false,
  "has_dynamic_index": false,
  "warnings": [],
  "note": "Scan for a qword pointer equal to next_scan_value to find the next level up. Repeat until struct_base lands in a static module (check with get_address_info)."
}
```
`next_scan_value` == `struct_base` (the base register's value): scan for a pointer equal to it to find the holder one level up. `scan_type` is present only when `is_64bit` is supplied.

### Parser scope (capped — bails loudly)
Supported memory-operand forms (case-insensitive; tolerant of CE quirks — hex displacement without `0x`, irregular spacing, optional `dword ptr` / `ds:` prefixes, trailing symbol comments):

| Form | `access_type` |
|------|---------------|
| `[base]` | `register_indirect` |
| `[base±disp]` | `register_indirect` |
| `[base+index*scale]` / `[base+index*scale±disp]` | `indexed` |
| `[disp]` (absolute) | `absolute` |
| `[rip±disp]` | `rip_relative` |

Anything outside this set → `{ "success": false, "error_code": "INVALID_PARAMS", "error": "Unrecognized memory operand: <operand>" }`. **No guessing** — a wrong base sends the agent down a dead pointer path.

### Conventions & edge handling
- **Displacements are hex** (CE disassembly convention). `[rcx+04]` → `displacement = 4`.
- **Register normalization:** the operand register (`rcx`, `ecx`, …) is upper-cased and looked up in `registers`; if the 64-bit key is absent, the 32-bit form is tried. A missing value → `INVALID_PARAMS` naming the register.
- **Cross-check:** if `accessed_address` is supplied and disagrees with the computed `base + index*scale + disp`, emit a warning (not an error) — register state can lag the captured access.
- **Static detection:** `rip_relative` or `absolute` → `is_static: true` (chain root). For these, `accessed_address` (if supplied) is the resolved global; the agent maps it to module+offset with `get_address_info`.
- **Indexed access** (`[rax+rcx*4+8]`): `base_register = rax` → `next_scan_value`. The level's offset (`rcx*4+8`) is index-dependent, so `has_dynamic_index: true` plus a warning. The tool reports facts only; the agent decides whether to freeze the index or pick a cleaner access.

---

## 4. TOOL 2 — `validate_pointer_chains`

**Purpose:** Resolve a list of candidate chains and report which land on a known address. Run it once to triage a fresh pointer scan, then again after a game restart/reload — the chains that survive both are the stable ones.

### Inputs
| Param | Type | Req | Notes |
|-------|------|-----|-------|
| `chains` | array | ✅ | `[{ "base": <addr|symbol>, "offsets": [int,…] }, …]`. Same shape `read_pointer_chain` accepts. |
| `target` | str | ✅ | Known current address of the value (e.g. from `scan_all`). |
| `include_misses` | bool | — | Default **false** — non-matching chains are counted, not echoed. |

Input is capped at **5000 chains/call**; exceeding it → `{ "success": false, "error_code": "INVALID_PARAMS", "error": "Too many chains (max 5000); page the input." }`.

### Output (token-frugal by design)
```json
{
  "success": true,
  "target": "0x1F2A4",
  "total": 4096,
  "matched": 3,
  "unreadable": 12,
  "matches": [
    { "base": "0x7FF6...", "offsets": [16, 0, 36], "final_address": "0x1F2A4", "final_value": "0x64" }
  ]
}
```
A 4096-candidate scan collapses to the few that hit — only `matches` are returned by default, so results never flood the agent's context. `unreadable` counts chains whose dereference failed mid-way (stale base, bad pointer).

### Reuse
Extract a local helper `resolveChain(base, offsets) -> (final_address, final_value, ok)` from the existing `cmd_read_pointer_chain` deref loop (CE chain convention: deref then add offset, `readPointer` throughout for 32/64-bit safety). Refactor `cmd_read_pointer_chain` to call the helper so both stay in sync.

---

## 5. ORCHESTRATION RECIPE (how the agent chains them)

```
# 0. Have the dynamic address of the value (from scan_all/next_scan):  TARGET
# 1. Watch it to capture the accessing instruction (anti-cheat-safe path):
start_dbvm_watch(TARGET)            # ...play the game so it gets accessed...
poll_dbvm_watch(TARGET)            -> { instruction:"mov [rcx+04],eax", registers:{RCX:...} }

# 2. Turn that into a base address (NEW, pure):
analyze_pointer_access(instruction, registers)
                                   -> { struct_base:"0x1F2A0", next_scan_value:"0x1F2A0", is_static:false }

# 3. Find pointers to that base (EXISTING):
scan_all(value="0x1F2A0", type="qword");  get_scan_results(limit=50)

# 4. Is the base static yet?  get_address_info(struct_base) -> in a module? -> done.
#    Otherwise treat each holder as the new TARGET and repeat 1-4.

# 5. Triage the assembled candidate chains, then confirm stability after a restart (NEW):
validate_pointer_chains(chains, TARGET)            -> matches: [...]
#    restart game, re-scan TARGET, then:
validate_pointer_chains(matches, NEW_TARGET)       -> the survivors are your stable path
```
Note: `scan_all` uses the single shared `serverState.scan_foundlist` slot — running a walk-back scan overwrites any in-progress value scan. That is why the scan step stays in the agent's hands (explicit), not buried inside a tool.

---

## 6. IMPLEMENTATION NOTES

- **Lua:** new `-- >>> BEGIN UNIT-24 Pointer Analysis <<<` block in `ce_mcp_bridge.lua` with `cmd_analyze_pointer_access`, `cmd_validate_pointer_chains`, and the shared `resolveChain` helper. Register both in `commandHandlers` (handlers are global funcs, not top-level locals — the 200-local compile limit). No new long-lived resources → no `cleanupZombieState` entry needed.
- **Python:** two `@mcp.tool()` one-liners in `mcp_cheatengine.py` calling `ce_client.send_command(...)`. Names match the dispatcher keys exactly.
- **Return shape / addresses:** `{success, …}` / `{success:false, error, error_code}`; all addresses out via `toHex()`; accept string or int in.
- **Docs:** add `§32 Pointer Analysis (Unit 24)` to `MCP_Bridge_Command_Reference.md` with request/response examples and the recipe above.

---

## 7. TESTING

- **`analyze_pointer_access` (pure) — offline TDD.** Table-driven cases written first, then the parser implemented to pass them: every supported operand form, CE-formatting quirks (no-`0x` hex, spacing, `dword ptr`/`ds:` prefixes, trailing comments), negative displacements, 32-bit register normalization, indexed/RIP/absolute, and bail cases. Runs on this Linux box with a stock Lua interpreter (no CE deps). *Verify a Lua interpreter is installed; flag if absent.*
- **`validate_pointer_chains` — integration.** Add a case to `all_tests` in `test_mcp.py`. Requires Windows + CE running + bridge loaded + a process attached, so it is **run by the user**, not from this dev box. Results will be reported as run, never assumed.

---

## 8. ESTIMATE

~215–265 lines new code (Lua + Python) + ~80 lines reference docs. `validate_pointer_chains` is low-risk (~70–90 Lua, wraps existing deref logic); `analyze_pointer_access` carries the risk in its operand parser (~85–115 Lua), which the offline tests pin down.
