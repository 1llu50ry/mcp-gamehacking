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

print(string.format("\n%d passed, %d failed", pass, fail))
os.exit(fail == 0 and 0 or 1)
