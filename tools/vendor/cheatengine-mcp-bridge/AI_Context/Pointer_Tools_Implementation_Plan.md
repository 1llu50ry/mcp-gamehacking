# Pointer Walk-back Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools — `analyze_pointer_access` (pure) and `validate_pointer_chains` — that let an AI agent automate pointer-chain candidate triage instead of writing auto-assembler logging scripts.

**Architecture:** Thin, composable handlers in the single self-contained `ce_mcp_bridge.lua`. `analyze_pointer_access` is pure Lua (string + register arithmetic), so it is unit-tested offline with a stock `lua` interpreter. Because the full bridge will not compile under Lua 5.4+ (a const-enforcement difference in the JSON codec, `ce_mcp_bridge.lua:357`), the offline tests extract just the marked UNIT-24 slice and `load()` it over a small `toHex` fixture. `validate_pointer_chains` reuses a new shared `resolveChain` helper (extracted from `cmd_read_pointer_chain`) and is also offline-tested by stubbing the CE built-in `readPointer`. The agent orchestrates the loop between them with existing tools (`start_dbvm_watch`, `scan_all`, `get_address_info`).

**Tech Stack:** Lua 5.x inside Cheat Engine (handlers), Python FastMCP (`mcp_cheatengine.py` wrappers), `lua` CLI for offline tests, `test_mcp.py` for live integration tests.

**Reference spec:** `AI_Context/Pointer_Tools_Design.md`

**Key file facts (verified):**
- Handler functions are **global** (`function cmd_x(params)`), defined before the `local commandHandlers = {` table at `ce_mcp_bridge.lua:5339`. Register new tools as `name = cmd_name,` inside that table (model: `read_pointer_chain = cmd_read_pointer_chain,` at line 5412).
- Insert the new **UNIT-24** handler block immediately **before** line 5339 (after the last handler `cmd_get_opened_process_handle`), so the table constructor can see the new globals.
- Avoid adding top-level `local`s (CE fails to compile a chunk with >200 locals) — declare the alias table and every helper as a **global**.
- `toHex(nil)` returns the string `"nil"`, so leave null output fields as Lua `nil` (never `toHex` them).
- `toHex(n)` formats `n <= 0xFFFFFFFF` as `0x%08X`, larger as `0x%X`. Tests assert exact strings accordingly.
- `resolveChain` may be defined in UNIT-24 (line ~5337) yet called by `cmd_read_pointer_chain` (line 1884): globals resolve at call time, after load completes, so this is fine.
- Offline tests do **not** load the whole bridge (it fails to compile under stock Lua 5.4+ at `ce_mcp_bridge.lua:357`, a generic-`for` const difference in the JSON codec). They read the file, extract the text between the `-- >>> BEGIN UNIT-24` and `END UNIT-24` markers with the Lua pattern `%-%- >>> BEGIN UNIT%-24.-END UNIT%-24` (`.` matches newlines in Lua patterns; `%-` escapes the literal hyphens), and `load()` that slice over a small `toHex` fixture (UNIT-24's only chunk-local dependency). Keep UNIT-24 free of Lua-5.3-only constructs so the slice loads cleanly. `readPointer`/`getAddressSafe` are CE globals, so tests stub `readPointer` globally and pass numeric addresses to skip `getAddressSafe`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `MCP_Server/ce_mcp_bridge.lua` | Modify | UNIT-24 block: pure helpers, `parseMemoryOperand`, `cmd_analyze_pointer_access`, `resolveChain`, `cmd_validate_pointer_chains`; refactor `cmd_read_pointer_chain`; 2 dispatcher entries. |
| `MCP_Server/mcp_cheatengine.py` | Modify | Two `@mcp.tool()` wrappers. |
| `MCP_Server/test_pointer_parse.lua` | Create | Offline unit tests (parser, analyze handler, validate handler via stubbed `readPointer`). |
| `MCP_Server/test_mcp.py` | Modify | Live integration smoke tests (analyze: no process needed; validate: derive-then-check). |
| `AI_Context/MCP_Bridge_Command_Reference.md` | Modify | New `§32 Pointer Analysis (Unit 24)`. |
| `AI_Context/Pointer_Tools_Design.md` | Modify | Flip status to implemented. |

---

## Task 1: Pure operand parser (`parseMemoryOperand`)

**Files:**
- Create: `MCP_Server/test_pointer_parse.lua`
- Modify: `MCP_Server/ce_mcp_bridge.lua` (insert UNIT-24 block before line 5339)

- [ ] **Step 1: Write the failing offline test**

Create `MCP_Server/test_pointer_parse.lua`:

```lua
-- Offline unit tests for UNIT-24 pure pointer-analysis logic.
-- Run: lua MCP_Server/test_pointer_parse.lua   (from repo root, or from MCP_Server/)
local here = arg[0]:match("^(.*)[/\\]") or "."

-- The whole bridge will not compile under stock Lua 5.4+ (a const difference in
-- the JSON codec at line 357), so extract and load only the UNIT-24 slice over a
-- small toHex fixture (UNIT-24's only chunk-local dependency).
local function loadUnit24()
    local f = assert(io.open(here .. "/ce_mcp_bridge.lua", "r"))
    local src = f:read("*a"); f:close()
    local slice = src:match("(%-%- >>> BEGIN UNIT%-24.-END UNIT%-24)")
    assert(slice, "could not find UNIT-24 slice (markers missing?)")
    local prelude = [[
local function toHex(num)
    if not num then return "nil" end
    if num >= 0 and num <= 0xFFFFFFFF then return string.format("0x%08X", num) end
    return string.format("0x%X", num)
end
]]
    assert(load(prelude .. "\n" .. slice))()
end
loadUnit24()

assert(type(parseMemoryOperand) == "function", "UNIT-24 slice did not define parseMemoryOperand")

local pass, fail = 0, 0
local function check(name, cond, got)
    if cond then
        pass = pass + 1
    else
        fail = fail + 1
        print("FAIL: " .. name .. (got ~= nil and ("  (got: " .. tostring(got) .. ")") or ""))
    end
end

-- form / base / index / scale / disp
local function P(instr) return parseMemoryOperand(instr) end

local r
r = P("mov [rcx+04],eax");        check("reg+disp form",   r and r.form=="register_indirect")
                                  check("reg+disp base",   r and r.base=="rcx")
                                  check("reg+disp disp",   r and r.disp==4, r and r.disp)
r = P("mov [rbp-08],eax");        check("reg-disp neg",    r and r.disp==-8, r and r.disp)
r = P("mov [rax+rcx*4+8],edx");   check("indexed form",    r and r.form=="indexed")
                                  check("indexed base",    r and r.base=="rax")
                                  check("indexed index",   r and r.index=="rcx")
                                  check("indexed scale",   r and r.scale==4, r and r.scale)
                                  check("indexed disp",    r and r.disp==8, r and r.disp)
r = P("mov [rax+rcx*4],edx");     check("indexed no disp", r and r.form=="indexed" and r.disp==0)
r = P("mov [rsi],eax");           check("bare reg form",   r and r.form=="register_indirect" and r.disp==0)
r = P("mov [rip+12345],eax");     check("rip form",        r and r.form=="rip_relative")
                                  check("rip disp hex",    r and r.disp==0x12345, r and r.disp)
r = P("mov dword ptr [rcx+10],eax"); check("ptr prefix",   r and r.base=="rcx" and r.disp==0x10, r and r.disp)
r = P("mov [7FF6ABCD],eax");      check("absolute form",   r and r.form=="absolute")
                                  check("absolute disp",   r and r.disp==0x7FF6ABCD, r and r.disp)
r = P("mov eax,[rdx+1C]");        check("src operand",     r and r.base=="rdx" and r.disp==0x1C, r and r.disp)
r = P("mov [ds:rcx+4],eax");      check("segment strip",   r and r.base=="rcx" and r.disp==4)
r = P("mov [rax+rcx],eax");       check("bail implicit scale", r==nil)
r = P("nop");                     check("bail no operand", r==nil)

print(string.format("\n%d passed, %d failed", pass, fail))
os.exit(fail == 0 and 0 or 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: FAIL — `could not find UNIT-24 slice (markers missing?)` (the UNIT-24 block doesn't exist yet; non-zero exit).

- [ ] **Step 3: Implement the parser**

In `MCP_Server/ce_mcp_bridge.lua`, insert this block **immediately before** `local commandHandlers = {` (line 5339):

```lua
-- >>> BEGIN UNIT-24 Pointer Analysis <<<

-- Bidirectional 32<->64-bit general-purpose register name aliases (uppercase keys).
-- Global (not local) to avoid the >200-local chunk compile limit.
POINTER_REG_ALIASES = {
    RAX="EAX", EAX="RAX", RBX="EBX", EBX="RBX", RCX="ECX", ECX="RCX",
    RDX="EDX", EDX="RDX", RSI="ESI", ESI="RSI", RDI="EDI", EDI="RDI",
    RBP="EBP", EBP="RBP", RSP="ESP", ESP="RSP", RIP="EIP", EIP="RIP",
    R8="R8D", R8D="R8", R9="R9D", R9D="R9", R10="R10D", R10D="R10",
    R11="R11D", R11D="R11", R12="R12D", R12D="R12", R13="R13D", R13D="R13",
    R14="R14D", R14D="R14", R15="R15D", R15D="R15",
}

function isPointerRegister(name)
    return name ~= nil and POINTER_REG_ALIASES[name:upper()] ~= nil
end

-- Parse a signed hex displacement string like "+1A" or "-08" -> integer.
function parseHexDisp(s)
    local sign, hex = s:match("^([%+%-])(%x+)$")
    if not hex then return nil end
    local v = tonumber(hex, 16)
    if sign == "-" then return -v end
    return v
end

-- Parse the first [...] memory operand of an instruction string.
-- Returns a table { form, base, index, scale, disp } or (nil, errmsg).
-- Displacements are hex (CE disassembly convention).
function parseMemoryOperand(instruction)
    if type(instruction) ~= "string" then
        return nil, "instruction must be a string"
    end
    local raw = instruction:match("%[([^%]]+)%]")
    if not raw then
        return nil, "no memory operand found in: " .. instruction
    end
    -- Normalize: drop spaces, lowercase, strip segment override (e.g. ds:).
    local op = raw:gsub("%s+", ""):lower():gsub("^[cdsefg]s:", "")

    local b, i, s, d

    -- [base+index*scale+disp] / [base+index*scale-disp]
    b, i, s, d = op:match("^(%w+)%+(%w+)%*(%d+)([%+%-]%x+)$")
    if b then
        return { form="indexed", base=b, index=i, scale=tonumber(s), disp=parseHexDisp(d) }
    end
    -- [base+index*scale]
    b, i, s = op:match("^(%w+)%+(%w+)%*(%d+)$")
    if b then
        return { form="indexed", base=b, index=i, scale=tonumber(s), disp=0 }
    end
    -- [base+disp] / [base-disp]  (base must be a register)
    b, d = op:match("^(%w+)([%+%-]%x+)$")
    if b and isPointerRegister(b) then
        local form = (b=="rip" or b=="eip") and "rip_relative" or "register_indirect"
        return { form=form, base=b, index=nil, scale=nil, disp=parseHexDisp(d) }
    end
    -- [base]  (register)
    b = op:match("^(%w+)$")
    if b and isPointerRegister(b) then
        return { form="register_indirect", base=b, index=nil, scale=nil, disp=0 }
    end
    -- [disp]  (absolute / direct address; all hex digits)
    local abs = op:match("^(%x+)$")
    if abs then
        return { form="absolute", base=nil, index=nil, scale=nil, disp=tonumber(abs, 16) }
    end

    return nil, "unrecognized memory operand: " .. raw
end

-- >>> END UNIT-24 (continued in later tasks) <<<
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: PASS — `20 passed, 0 failed` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add MCP_Server/ce_mcp_bridge.lua MCP_Server/test_pointer_parse.lua
git commit -m "feature: add memory-operand parser for pointer walk-back (UNIT-24)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `cmd_analyze_pointer_access` handler

**Files:**
- Modify: `MCP_Server/ce_mcp_bridge.lua` (extend UNIT-24 block; add dispatcher entry near line 5412)
- Modify: `MCP_Server/mcp_cheatengine.py` (wrapper after the `read_pointer_chain` tool, ~line 552)
- Modify: `MCP_Server/test_pointer_parse.lua` (append analyze cases)
- Modify: `MCP_Server/test_mcp.py` (append integration smoke test in `main`, before the `for test in ...run` of the first group, ~line 400)

- [ ] **Step 1: Append the failing analyze tests**

Append to `MCP_Server/test_pointer_parse.lua`, **before** the final `print(...)`/`os.exit(...)` lines:

```lua
assert(type(cmd_analyze_pointer_access) == "function", "UNIT-24 slice did not define cmd_analyze_pointer_access")

local A = cmd_analyze_pointer_access

local a
a = A({ instruction="mov [rcx+04],eax", registers={ RCX="0x1000" } })
check("analyze ok",            a.success==true)
check("analyze struct_base",   a.struct_base=="0x00001000", a.struct_base)
check("analyze next_scan",     a.next_scan_value=="0x00001000", a.next_scan_value)
check("analyze disp",          a.displacement==4, a.displacement)
check("analyze accessed",      a.accessed_address=="0x00001004", a.accessed_address)
check("analyze not static",    a.is_static==false)

-- 32-bit operand register resolves via alias to the 64-bit snapshot key.
a = A({ instruction="mov [ecx+4],eax", registers={ RCX="0x2000" } })
check("analyze alias 32->64",  a.success==true and a.struct_base=="0x00002000", a.struct_base)

-- Indexed access: base is the array pointer; offset is index-dependent.
a = A({ instruction="mov [rax+rcx*4+8],edx", registers={ RAX="0x1000", RCX="0x2" } })
check("analyze indexed base",  a.struct_base=="0x00001000", a.struct_base)
check("analyze indexed addr",  a.accessed_address=="0x00001010", a.accessed_address)
check("analyze dynamic index", a.has_dynamic_index==true)
check("analyze indexed warn",  #a.warnings >= 1)

-- Absolute: static chain root, no next level to scan for.
a = A({ instruction="mov [7FF60000],eax", registers={} })
check("analyze absolute static", a.is_static==true)
check("analyze absolute addr",   a.accessed_address=="0x7FF60000", a.accessed_address)
check("analyze absolute no scan", a.next_scan_value==nil)

-- RIP-relative: trust provided accessed_address (instr length unknown).
a = A({ instruction="mov [rip+10],eax", registers={ RIP="0x7FF60000" }, accessed_address="0x7FF6ABCD" })
check("analyze rip static",    a.is_static==true)
check("analyze rip trusts addr", a.accessed_address=="0x7FF6ABCD", a.accessed_address)

-- Missing register value -> error.
a = A({ instruction="mov [rcx+4],eax", registers={ RAX="0x1" } })
check("analyze missing reg",   a.success==false and a.error_code=="INVALID_PARAMS")

-- Cross-check mismatch -> warning, still success.
a = A({ instruction="mov [rcx+4],eax", registers={ RCX="0x1000" }, accessed_address="0x9999" })
check("analyze crosscheck warn", a.success==true and #a.warnings >= 1)

-- is_64bit sets scan_type.
a = A({ instruction="mov [rcx+4],eax", registers={ RCX="0x1000" }, is_64bit=true })
check("analyze scan_type",     a.scan_type=="qword", a.scan_type)

-- Unrecognized operand bubbles up as INVALID_PARAMS.
a = A({ instruction="mov [rax+rcx],eax", registers={ RAX="0x1000" } })
check("analyze bail",          a.success==false and a.error_code=="INVALID_PARAMS")
```

- [ ] **Step 2: Run to verify it fails**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: FAIL — `UNIT-24 slice did not define cmd_analyze_pointer_access`.

- [ ] **Step 3: Implement the handler**

In `MCP_Server/ce_mcp_bridge.lua`, **replace** the line `-- >>> END UNIT-24 (continued in later tasks) <<<` with:

```lua
-- Coerce a hex-string ("0x..."), decimal string, or number to a number.
function toNumberAny(v)
    if type(v) == "number" then return v end
    if type(v) == "string" then return tonumber(v) or tonumber(v, 16) end
    return nil
end

-- Look up a register value from a hit snapshot, trying the 32/64-bit alias.
function resolveRegisterValue(registers, regName)
    local up = regName:upper()
    local v = registers[up]
    if v == nil then
        local alias = POINTER_REG_ALIASES[up]
        if alias then v = registers[alias] end
    end
    return toNumberAny(v)
end

-- Format a signed displacement as "+0xN" / "-0xN".
function formatHexDisp(disp)
    if disp == nil then return nil end
    if disp < 0 then return string.format("-0x%X", -disp) end
    return string.format("+0x%X", disp)
end

-- Turn one captured memory access into pointer-walk-back facts. Pure: no CE API calls.
function cmd_analyze_pointer_access(params)
    local instruction = params.instruction
    local registers = params.registers
    if type(instruction) ~= "string" then
        return { success=false, error="instruction (string) is required", error_code="INVALID_PARAMS" }
    end
    if type(registers) ~= "table" then
        return { success=false, error="registers (object) is required", error_code="INVALID_PARAMS" }
    end

    local op, err = parseMemoryOperand(instruction)
    if not op then
        return { success=false, error=err, error_code="INVALID_PARAMS" }
    end

    local warnings = {}
    local result = {
        success = true,
        access_type = op.form,
        base_register = op.base and op.base:upper() or nil,
        index_register = op.index and op.index:upper() or nil,
        scale = op.scale,
        displacement = op.disp,
        hex_displacement = formatHexDisp(op.disp),
        struct_base = nil,
        accessed_address = nil,
        next_scan_value = nil,
        is_static = (op.form == "rip_relative" or op.form == "absolute"),
        has_dynamic_index = (op.form == "indexed"),
        warnings = warnings,
    }
    if params.is_64bit ~= nil then
        result.scan_type = params.is_64bit and "qword" or "dword"
    end

    -- Static roots terminate the chain; nothing to scan for.
    if op.form == "absolute" then
        result.accessed_address = toHex(op.disp)
        result.note = "Absolute/global address. Chain root: map with get_address_info."
        return result
    end
    if op.form == "rip_relative" then
        if params.accessed_address ~= nil then
            result.accessed_address = toHex(toNumberAny(params.accessed_address) or 0)
        else
            table.insert(warnings, "rip_relative: accessed_address not provided and cannot be computed without instruction length")
        end
        result.note = "RIP-relative/global. Chain root: map with get_address_info."
        return result
    end

    -- register_indirect / indexed: climb one level.
    local baseVal = resolveRegisterValue(registers, op.base)
    if baseVal == nil then
        return { success=false, error="register value not provided: " .. result.base_register, error_code="INVALID_PARAMS" }
    end
    result.struct_base = toHex(baseVal)
    result.next_scan_value = toHex(baseVal)

    local accessed = baseVal + (op.disp or 0)
    if op.form == "indexed" then
        local idxVal = resolveRegisterValue(registers, op.index)
        if idxVal ~= nil then
            accessed = baseVal + idxVal * (op.scale or 1) + (op.disp or 0)
        else
            accessed = nil
            table.insert(warnings, "index register value not provided; accessed_address not computed")
        end
        table.insert(warnings, "indexed access: this level's offset (index*scale+disp) is index-dependent")
    end
    if accessed ~= nil then
        result.accessed_address = toHex(accessed)
    end

    if params.accessed_address ~= nil and accessed ~= nil then
        local given = toNumberAny(params.accessed_address)
        if given ~= nil and given ~= accessed then
            table.insert(warnings, "computed accessed_address differs from provided value; register state may lag the access")
        end
    end

    result.note = "Scan for a pointer equal to next_scan_value to find the holder one level up. Repeat until struct_base lands in a static module (check with get_address_info)."
    return result
end

-- >>> END UNIT-24 (continued in later tasks) <<<
```

- [ ] **Step 4: Run to verify offline tests pass**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: PASS — all parser + analyze checks (`40 passed, 0 failed` or similar), exit 0.

- [ ] **Step 5: Register the dispatcher entry**

In `MCP_Server/ce_mcp_bridge.lua`, in the `commandHandlers` table, **after** the line `read_pointer_chain = cmd_read_pointer_chain,` (line 5412) add:

```lua
    analyze_pointer_access = cmd_analyze_pointer_access,
```

- [ ] **Step 6: Add the Python wrapper**

In `MCP_Server/mcp_cheatengine.py`, **after** the `read_pointer_chain` tool (the block ending at line 552) add:

```python
@mcp.tool()
def analyze_pointer_access(instruction: str, registers: dict, accessed_address: str = None, is_64bit: bool = None) -> str:
    """Parse a captured memory access (instruction + register snapshot from a breakpoint/DBVM hit) into base register, displacement, and the concrete struct-base address for pointer-chain walk-back. Pure analysis; no process access. next_scan_value is the address to scan for (as a pointer) to find the next level up."""
    return format_result(ce_client.send_command("analyze_pointer_access", {
        "instruction": instruction,
        "registers": registers,
        "accessed_address": accessed_address,
        "is_64bit": is_64bit,
    }))
```

- [ ] **Step 7: Add a live integration smoke test (no process required)**

In `MCP_Server/test_mcp.py` `main()`, after the utility tests are registered and before their run loop (near line 400), add:

```python
    all_tests["analyze_pointer_access"] = TestCase(
        name="analyze_pointer_access (pure)",
        method="analyze_pointer_access",
        params={"instruction": "mov [rcx+04],eax", "registers": {"RCX": "0x1000"}},
        validators=[
            lambda r: (r.get("struct_base") == "0x00001000", f"struct_base={r.get('struct_base')}"),
            lambda r: (r.get("displacement") == 4, f"displacement={r.get('displacement')}"),
            lambda r: (r.get("next_scan_value") == "0x00001000", f"next_scan_value={r.get('next_scan_value')}"),
        ],
    )
    all_tests["analyze_pointer_access"].run(client)
```

- [ ] **Step 8: Commit**

```bash
git add MCP_Server/ce_mcp_bridge.lua MCP_Server/mcp_cheatengine.py MCP_Server/test_pointer_parse.lua MCP_Server/test_mcp.py
git commit -m "feature: add analyze_pointer_access tool (UNIT-24)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `resolveChain` helper + `validate_pointer_chains` + refactor

**Files:**
- Modify: `MCP_Server/ce_mcp_bridge.lua` (extend UNIT-24; refactor `cmd_read_pointer_chain` at line 1884; add dispatcher entry)
- Modify: `MCP_Server/mcp_cheatengine.py` (wrapper)
- Modify: `MCP_Server/test_pointer_parse.lua` (append validate + read_pointer_chain regression cases)
- Modify: `MCP_Server/test_mcp.py` (live derive-then-validate test)

- [ ] **Step 1: Append the failing validate tests**

Append to `MCP_Server/test_pointer_parse.lua`, before the final `print`/`os.exit`:

```lua
assert(type(cmd_validate_pointer_chains) == "function", "UNIT-24 slice did not define cmd_validate_pointer_chains")
assert(type(resolveChain) == "function", "UNIT-24 slice did not define resolveChain")

-- Stub the CE built-in readPointer with a fake address space. Use NUMERIC
-- addresses everywhere so getAddressSafe is never invoked offline.
local FAKE = { [0x1000]=0x2000, [0x2010]=0x3000, [0x3000]=0x64 }
readPointer = function(addr) return FAKE[addr] end

-- chain: base 0x1000, offsets [0x10, 0x0]
--   read(0x1000)=0x2000; +0x10 -> 0x2010; read(0x2010)=0x3000; +0 -> 0x3000 (final)
local v = cmd_validate_pointer_chains({
    chains = {
        { base=0x1000, offsets={0x10, 0x0} },   -- resolves to 0x3000 (match)
        { base=0x9999, offsets={0x0} },          -- unreadable (no FAKE entry)
        { base=0x1000, offsets={0x10, 0x4} },    -- resolves to 0x3004 (miss)
    },
    target = 0x3000,
})
check("validate total",     v.total==3, v.total)
check("validate matched",   v.matched==1, v.matched)
check("validate unreadable", v.unreadable==1, v.unreadable)
check("validate match addr", v.matches[1] and v.matches[1].final_address=="0x00003000", v.matches[1] and v.matches[1].final_address)
check("validate match value", v.matches[1] and v.matches[1].final_value==0x64, v.matches[1] and v.matches[1].final_value)
check("validate hides misses", v.misses==nil)

-- include_misses surfaces the non-matchers.
local v2 = cmd_validate_pointer_chains({
    chains = { { base=0x1000, offsets={0x10, 0x4} } },
    target = 0x3000,
    include_misses = true,
})
check("validate include_misses", v2.misses ~= nil and #v2.misses==1)

-- Cap enforcement.
local big = {}
for i=1,5001 do big[i] = { base=0x1000, offsets={0x0} } end
local v3 = cmd_validate_pointer_chains({ chains=big, target=0x1000 })
check("validate cap", v3.success==false and v3.error_code=="INVALID_PARAMS")

-- resolveChain (the shared helper, in the UNIT-24 slice) is offline-testable directly.
-- cmd_read_pointer_chain itself (line 1884) is outside the slice; its refactor is a
-- thin key-remap over resolveChain and is verified by the live read_pointer_chain path.
local rcok = resolveChain(0x1000, {0x10, 0x0})
check("resolveChain ok",    rcok.ok==true)
check("resolveChain final", rcok.final_address_hex=="0x00003000", rcok.final_address_hex)
check("resolveChain value", rcok.final_value==0x64, rcok.final_value)
check("resolveChain steps", rcok.chain and #rcok.chain==3, rcok.chain and #rcok.chain)
local rcbad = resolveChain(0x9999, {0x0})
check("resolveChain fail",  rcbad.ok==false)
```

- [ ] **Step 2: Run to verify it fails**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: FAIL — `UNIT-24 slice did not define cmd_validate_pointer_chains`.

- [ ] **Step 3: Implement `resolveChain` + `cmd_validate_pointer_chains`**

In `MCP_Server/ce_mcp_bridge.lua`, replace the `-- >>> END UNIT-24 (continued in later tasks) <<<` line with:

```lua
-- Resolve a pointer chain (CE convention: deref, then add offset). Pure of any
-- output formatting beyond toHex; uses CE's readPointer / getAddressSafe.
-- Returns a table: ok + (final_address number, final_address_hex, final_value, chain) or (error, chain, failed_at).
function resolveChain(base, offsets)
    local baseNum = base
    if type(baseNum) == "string" then baseNum = getAddressSafe(baseNum) end
    if not baseNum then
        return { ok=false, error="Invalid base address" }
    end
    local cur = baseNum
    local chain = { { step=0, address=toHex(cur), description="base" } }
    for i, offset in ipairs(offsets or {}) do
        local ptr = readPointer(cur)
        if not ptr then
            return { ok=false, error="Failed to read pointer at step " .. i, chain=chain, failed_at=toHex(cur) }
        end
        cur = ptr + offset
        table.insert(chain, {
            step=i, address=toHex(cur), offset=offset,
            hex_offset=string.format("+0x%X", offset), pointer_value=toHex(ptr),
        })
    end
    local finalValue = nil
    pcall(function() finalValue = readPointer(cur) end)
    return { ok=true, base=toHex(baseNum), final_address=cur, final_address_hex=toHex(cur), final_value=finalValue, chain=chain }
end

-- Resolve many candidate chains; report which land on target (matches only by default).
function cmd_validate_pointer_chains(params)
    local chains = params.chains
    if type(chains) ~= "table" then
        return { success=false, error="chains (array) is required", error_code="INVALID_PARAMS" }
    end
    if #chains > 5000 then
        return { success=false, error="Too many chains (max 5000); page the input.", error_code="INVALID_PARAMS" }
    end
    local target = params.target
    if type(target) == "string" then target = getAddressSafe(target) end
    if not target then
        return { success=false, error="Invalid target address", error_code="INVALID_ADDRESS" }
    end
    local includeMisses = params.include_misses == true

    local matched, unreadable = 0, 0
    local matches = {}
    local misses = includeMisses and {} or nil

    for _, c in ipairs(chains) do
        local offs = c.offsets or {}
        local r = resolveChain(c.base, offs)
        if not r.ok then
            unreadable = unreadable + 1
            if includeMisses then
                table.insert(misses, { base=c.base, offsets=offs, error=r.error })
            end
        elseif r.final_address == target then
            matched = matched + 1
            table.insert(matches, { base=r.base, offsets=offs, final_address=r.final_address_hex, final_value=r.final_value })
        elseif includeMisses then
            table.insert(misses, { base=r.base, offsets=offs, final_address=r.final_address_hex, final_value=r.final_value })
        end
    end

    local out = {
        success = true,
        target = toHex(target),
        total = #chains,
        matched = matched,
        unreadable = unreadable,
        matches = matches,
    }
    if includeMisses then out.misses = misses end
    return out
end

-- >>> END UNIT-24 <<<
```

- [ ] **Step 4: Refactor `cmd_read_pointer_chain` to use `resolveChain`**

In `MCP_Server/ce_mcp_bridge.lua`, replace the entire body of `cmd_read_pointer_chain` (lines 1884–1931) with:

```lua
function cmd_read_pointer_chain(params)
    local offsets = params.offsets or {}
    local r = resolveChain(params.base, offsets)
    if not r.ok then
        return { success=false, error=r.error, partial_chain=r.chain, failed_at_address=r.failed_at }
    end
    return {
        success = true,
        base = r.base,
        offsets = offsets,
        final_address = r.final_address_hex,
        final_value = r.final_value,
        chain = r.chain,
    }
end
```

`cmd_read_pointer_chain` lives at line 1884 (outside the UNIT-24 slice), so the offline harness does not load it; its refactor is a thin key-remap over the already-tested `resolveChain` and is verified by the live `read_pointer_chain` path in `test_mcp.py`.

- [ ] **Step 5: Run offline tests to verify they pass**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: PASS — parser + analyze + validate + resolveChain checks all green, exit 0.

- [ ] **Step 6: Register the dispatcher entry**

In `MCP_Server/ce_mcp_bridge.lua`, after the `analyze_pointer_access = cmd_analyze_pointer_access,` line added in Task 2, add:

```lua
    validate_pointer_chains = cmd_validate_pointer_chains,
```

- [ ] **Step 7: Add the Python wrapper**

In `MCP_Server/mcp_cheatengine.py`, after the `analyze_pointer_access` tool added in Task 2, add:

```python
@mcp.tool()
def validate_pointer_chains(chains: list, target: str, include_misses: bool = False) -> str:
    """Resolve a list of candidate pointer chains and report which currently land on `target`. Each chain is {"base": <addr|symbol>, "offsets": [int,...]}. Returns only matches by default (token-frugal); set include_misses=true to also list non-matches. Re-run after a game restart with the new target to find chains that stay valid (the stable pointer). Max 5000 chains per call."""
    return format_result(ce_client.send_command("validate_pointer_chains", {
        "chains": chains,
        "target": target,
        "include_misses": include_misses,
    }))
```

- [ ] **Step 8: Add the live derive-then-validate integration test**

In `MCP_Server/test_mcp.py` `main()`, after the memory-read test group runs (after the module base is known; near line 575 where `module_base` is in scope), add:

```python
    # validate_pointer_chains: derive a real chain, then confirm it validates.
    print(f"\n{'='*60}\nTesting: validate_pointer_chains (derived)\n{'='*60}")
    rpc = client.send_command("read_pointer_chain", {"base": module_base, "offsets": [0]}).get("result", {})
    derived_target = rpc.get("final_address")
    if derived_target:
        vr = client.send_command("validate_pointer_chains", {
            "chains": [
                {"base": module_base, "offsets": [0]},
                {"base": module_base, "offsets": [0x7FFFFFF0]},  # likely unreadable
            ],
            "target": derived_target,
        }).get("result", {})
        ok = vr.get("matched", 0) >= 1 and any(m.get("final_address") == derived_target for m in vr.get("matches", []))
        print("✓ PASSED" if ok else f"✗ FAILED: {vr}")
    else:
        print("⊘ SKIPPED: could not derive a target via read_pointer_chain")
```

- [ ] **Step 9: Commit**

```bash
git add MCP_Server/ce_mcp_bridge.lua MCP_Server/mcp_cheatengine.py MCP_Server/test_pointer_parse.lua MCP_Server/test_mcp.py
git commit -m "feature: add validate_pointer_chains + extract resolveChain (UNIT-24)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reference docs + spec status

**Files:**
- Modify: `AI_Context/MCP_Bridge_Command_Reference.md` (add `§32`)
- Modify: `AI_Context/Pointer_Tools_Design.md` (status line)

- [ ] **Step 1: Add the reference section**

Append to `AI_Context/MCP_Bridge_Command_Reference.md`:

````markdown
---

## 32. Pointer Analysis (Unit 24)

### `analyze_pointer_access`

**Purpose:** Turn one captured memory access (the instruction + register snapshot from a `get_breakpoint_hits` / `poll_dbvm_watch` hit) into pointer-chain walk-back facts. Pure analysis — no process access.

**Parameters:**
- `instruction` (str, required): e.g. `"mov [rcx+04],eax"`.
- `registers` (object, required): register → value map, e.g. `{"RCX":"0x1F2A0"}`.
- `accessed_address` (str, optional): the faulting address if known; cross-checked.
- `is_64bit` (bool, optional): when set, adds a suggested `scan_type` (`qword`/`dword`).

**Returns:** `success`, `access_type` (`register_indirect`|`indexed`|`rip_relative`|`absolute`), `base_register`, `index_register`, `scale`, `displacement`, `hex_displacement`, `struct_base`, `accessed_address`, `next_scan_value`, `is_static`, `has_dynamic_index`, `warnings`, `note`. Unrecognized operands return `{success:false, error_code:"INVALID_PARAMS"}`.

**Example request:**
```json
{"method": "analyze_pointer_access", "params": {"instruction": "mov [rcx+04],eax", "registers": {"RCX": "0x1F2A0"}}}
```

**Example response:**
```json
{"success": true, "access_type": "register_indirect", "base_register": "RCX", "displacement": 4, "struct_base": "0x0001F2A0", "accessed_address": "0x0001F2A4", "next_scan_value": "0x0001F2A0", "is_static": false, "has_dynamic_index": false, "warnings": []}
```

---

### `validate_pointer_chains`

**Purpose:** Resolve many candidate chains and report which land on a known address. Re-run after a restart to find stable chains.

**Parameters:**
- `chains` (array, required): `[{"base": <addr|symbol>, "offsets": [int,...]}, ...]` (max 5000).
- `target` (str, required): known current address of the value.
- `include_misses` (bool, default false): also list non-matching chains.

**Returns:** `success`, `target`, `total`, `matched`, `unreadable`, `matches` (`[{base, offsets, final_address, final_value}]`), and `misses` when `include_misses` is true.

**Example request:**
```json
{"method": "validate_pointer_chains", "params": {"chains": [{"base": "0x7FF600000000", "offsets": [16, 0, 36]}], "target": "0x1F2A4"}}
```

**Example response:**
```json
{"success": true, "target": "0x0001F2A4", "total": 1, "matched": 1, "unreadable": 0, "matches": [{"base": "0x7FF600000000", "offsets": [16, 0, 36], "final_address": "0x0001F2A4", "final_value": "0x64"}]}
```

**Walk-back recipe:** `start_dbvm_watch` → `poll_dbvm_watch` → `analyze_pointer_access` → `scan_all(next_scan_value, "qword")` → repeat until `get_address_info` shows a module → `validate_pointer_chains` (twice, across a restart).
````

- [ ] **Step 2: Flip the spec status**

In `AI_Context/Pointer_Tools_Design.md`, change the status line:

```markdown
**Status:** ✅ Implemented (UNIT-24)
```

- [ ] **Step 3: Final offline verification**

Run: `lua MCP_Server/test_pointer_parse.lua`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git add AI_Context/MCP_Bridge_Command_Reference.md AI_Context/Pointer_Tools_Design.md
git commit -m "docs: document pointer analysis tools (UNIT-24, ref §32)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Live verification (user, on Windows)

The offline suite (`lua MCP_Server/test_pointer_parse.lua`) covers parsing, analysis, chain resolution, and validation logic without Cheat Engine. The CE-side behavior must still be confirmed on the Windows host:

1. Reload the Lua bridge in CE (`File -> Execute Script`), confirm `[MCP v12.0.0] ... Listening`.
2. With a process attached, run `python MCP_Server/test_mcp.py` and confirm the two new cases (`analyze_pointer_access`, `validate_pointer_chains (derived)`) pass.
3. These cannot be run from the Linux dev box; report results as actually observed.

---

## Self-Review

**Spec coverage:** `analyze_pointer_access` (§3) → Tasks 1–2; parser scope + bail (§3) → Task 1 cases incl. bail; static/indexed/cross-check edges (§3) → Task 2 cases; `validate_pointer_chains` + matches-only + cap (§4) → Task 3; `resolveChain` extraction + `read_pointer_chain` refactor (§4) → Task 3 Steps 3–4; orchestration recipe (§5) → reference §32; testing split (§7) → offline suite + `test_mcp.py`. All covered.

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output.

**Type/name consistency:** `parseMemoryOperand` fields (`form/base/index/scale/disp`) consistent across Tasks 1–2; `resolveChain` return keys (`ok/final_address/final_address_hex/final_value/chain/failed_at`) consistent between definition (Task 3 Step 3) and both consumers (`cmd_read_pointer_chain` Step 4, `cmd_validate_pointer_chains` Step 3); dispatcher keys equal Python tool names equal `cmd_*` suffixes.
