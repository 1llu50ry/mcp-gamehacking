"""Windows PE games: find every function in an .exe/.dll and turn each into a target.

The same shape as split.py's ROM functions, so the rest of decomp.wtf does not care where a
target came from. Function boundaries come from, in order of reliability:

1. the x86-64 exception directory (.pdata): a RUNTIME_FUNCTION for every function, begin and end;
2. the executable's own COFF symbol table (MinGW keeps one; MSVC release builds usually don't);
3. exports and the entry point;
4. direct call targets found by walking the code (32-bit games have no .pdata).

Relocations are discovered by decoding the code: a relative call/jump or a RIP-relative memory
operand says which address the instruction refers to, and which bytes the compiler will patch.
That is what makes a compiled candidate comparable with bytes fixed up by the linker.
"""

from __future__ import annotations

import bisect
import hashlib
import re
import struct
from dataclasses import dataclass, field

import capstone

from ..coffobj import trim_code
from . import buildinfo
from .symbols import Symbol

MACHINES = {0x014C: "x86", 0x8664: "x86_64", 0x01C4: "arm", 0xAA64: "arm64"}
EXECUTABLE = 0x20000000
CODE = 0x00000020
SMALL = 64 * 1024 * 1024
# How much code in one section is walked to find where each function ends. Beyond this, a 32-bit image
# keeps the old next-start boundaries rather than decoding millions of instructions in memory.
WALK_LIMIT = 16 * 1024 * 1024
TERMINATORS = {"ret", "retf", "int3", "hlt", "ud2"}
PADDING = {0x00, 0x90, 0xCC}  # alignment fill: zero, nop, int3 (MSVC)


class PeError(ValueError):
    pass


@dataclass
class PeSection:
    name: str
    va: int  # RVA
    size: int
    raw_size: int
    raw: int
    characteristics: int

    @property
    def code(self) -> bool:
        return bool(self.characteristics & (EXECUTABLE | CODE))

    def data(self, blob: bytes) -> bytes:
        return blob[self.raw:self.raw + self.raw_size]


@dataclass
class PeFunction:
    name: str
    vram: int
    rom: int
    section: str
    code: bytes
    asm: str
    n_insns: int
    refs: list[tuple[int, int, int, int]] = field(default_factory=list)  # (field offset, reloc type, address, insn end)
    exact: bool = True  # boundary from .pdata/symbol, not a padded guess


@dataclass
class PeImage:
    arch: str
    machine: int
    image_base: int
    info: dict
    sections: list[PeSection]
    functions: list[PeFunction]
    symbols: list[Symbol]
    data: list  # (name, vram, size, kind, preview)
    entry: int
    pe32_plus: bool

    @property
    def segments(self) -> list[dict]:
        return [{"name": s.name, "rom_start": s.raw, "rom_end": s.raw + s.raw_size, "vram": self.image_base + s.va}
                for s in self.sections if s.raw_size]


# ------------------------------------------------------------------ headers

def _u16(data: bytes, at: int) -> int:
    return struct.unpack_from("<H", data, at)[0]


def _u32(data: bytes, at: int) -> int:
    return struct.unpack_from("<I", data, at)[0]


def _u64(data: bytes, at: int) -> int:
    return struct.unpack_from("<Q", data, at)[0]


def is_pe(data: bytes) -> bool:
    if len(data) < 0x40 or data[:2] != b"MZ":
        return False
    at = _u32(data, 0x3C)
    return 0 < at <= len(data) - 24 and data[at:at + 4] == b"PE\0\0"


def _rva(data: bytes, sections: list[PeSection], rva: int, size: int = 1) -> bytes | None:
    for s in sections:
        if s.va <= rva and rva + size <= s.va + max(s.raw_size, s.size):
            return data[s.raw + rva - s.va:s.raw + rva - s.va + size]
    if rva < len(data):  # headers (data directories live in them)
        return data[rva:rva + size]
    return None


def _rva32(data: bytes, sections: list[PeSection], rva: int) -> int:
    raw = _rva(data, sections, rva, 4)
    return _u32(raw, 0) if raw else 0


def _cstr(data: bytes, sections: list[PeSection], rva: int, limit: int = 512) -> str:
    for s in sections:
        if s.va <= rva < s.va + max(s.raw_size, s.size):
            raw = data[s.raw + rva - s.va:s.raw + rva - s.va + limit]
            return raw.split(b"\0", 1)[0].decode("utf-8", "replace")
    return ""


def _headers(data: bytes) -> tuple[int, str, int, bool, list[PeSection], int, list[tuple[int, int]]]:
    at = _u32(data, 0x3C)
    machine, nsections, _time, _symptr, _nsyms, optsize, _chars = struct.unpack_from("<HHIIIHH", data, at + 4)
    opt = at + 24
    magic = _u16(data, opt)
    if magic not in (0x10B, 0x20B) or machine not in MACHINES:
        raise PeError("this is a PE image, but not one for x86, x86-64 or ARM")
    plus = magic == 0x20B
    image_base = _u64(data, opt + 24) if plus else _u32(data, opt + 28)
    ndirs = _u32(data, opt + (108 if plus else 92))
    dirs_at = opt + (112 if plus else 96)
    dirs = [( _u32(data, dirs_at + 8 * i), _u32(data, dirs_at + 8 * i + 4)) for i in range(min(ndirs, 16))]
    entry = _u32(data, opt + 16)
    sections = []
    sec_at = opt + optsize
    for i in range(nsections):
        raw, vsize, va, rawsize, rawptr, _rel, _nline, _nrel, _nlno, chars = struct.unpack_from("<8sIIIIIIHHI", data, sec_at + 40 * i)
        name = raw.split(b"\0", 1)[0].decode("ascii", "replace")
        sections.append(PeSection(name, va, vsize, rawsize, rawptr, chars))
    return machine, MACHINES[machine], image_base, plus, sections, entry, dirs


# ------------------------------------------------------------------ symbols from the image

def _coff_symbols(data: bytes, sections: list[PeSection], image_base: int) -> list[Symbol]:
    at = _u32(data, 0x3C)
    machine, _n, _t, symptr, nsyms, _o, _c = struct.unpack_from("<HHIIIHH", data, at + 4)
    if not symptr or not nsyms or symptr + 18 > len(data):
        return []
    by_section = {i + 1: s for i, s in enumerate(sections)}
    out: list[Symbol] = []
    k = 0
    while k < nsyms:
        if symptr + 18 * (k + 1) > len(data):
            break
        raw, value, section, typ, storage, naux = struct.unpack_from("<8sIhHBB", data, symptr + 18 * k)
        k += 1 + naux
        if raw[:4] == b"\0\0\0\0":
            off = _u32(raw, 4)
            name = data[symptr + nsyms * 18 + off:symptr + nsyms * 18 + off + 200].split(b"\0", 1)[0].decode(
                "utf-8", "replace")
        else:
            name = raw.split(b"\0", 1)[0].decode("utf-8", "replace")
        sec = by_section.get(section)
        if sec is None or not name or name.startswith((".", "$")) or storage == 103:  # 103: file name
            continue
        addr = image_base + sec.va + value
        kind = "func" if typ & 0x20 else "data"
        out.append(Symbol(name, addr, 0, kind))
        if machine == 0x014C and name.startswith("_") and not name.startswith("__"):
            out.append(Symbol(name[1:], addr, 0, kind))
    return out


def _exports(data: bytes, sections: list[PeSection], dirs: list[tuple[int, int]], image_base: int) -> list[Symbol]:
    rva, size = dirs[0] if dirs else (0, 0)
    if not rva or not size:
        return []
    raw = _rva(data, sections, rva, 40)
    if raw is None:
        return []
    _nfuncs, nnames, funcs, names, ords = struct.unpack_from("<IIIII", raw, 20)
    out = []
    for i in range(min(nnames, 65536)):
        name_rva = _rva32(data, sections, names + 4 * i)
        ordinal_raw = _rva(data, sections, ords + 2 * i, 2)
        if not name_rva or ordinal_raw is None:
            continue
        ordinal = _u16(ordinal_raw, 0)
        fn_rva = _rva32(data, sections, funcs + 4 * ordinal)
        if not fn_rva:
            continue
        name = _cstr(data, sections, name_rva)
        if name:
            out.append(Symbol(name, image_base + fn_rva, 0, "func"))
    return out


def _imports(data: bytes, sections: list[PeSection], dirs: list[tuple[int, int]], image_base: int,
             plus: bool) -> list[Symbol]:
    rva, size = dirs[1] if len(dirs) > 1 else (0, 0)
    if not rva or not size:
        return []
    width = 8 if plus else 4
    flag = 1 << (63 if plus else 31)
    out = []
    for i in range(4096):
        desc = _rva(data, sections, rva + 20 * i, 20)
        if desc is None or not any(desc):
            break
        original, _t, _f, name_rva, first = struct.unpack("<IIIII", desc)
        dll = _cstr(data, sections, name_rva)
        thunks = original or first
        for k in range(65536):
            raw = _rva(data, sections, thunks + width * k, width)
            if raw is None:
                break
            value = int.from_bytes(raw, "little")
            if value == 0:
                break
            slot = image_base + first + width * k
            out.append(Symbol(f"__imp_{_thunk_name(value, flag, data, sections, image_base)}", slot, width, "data"))
            if dll:
                out.append(Symbol(f"__imp_{dll}_{_thunk_name(value, flag, data, sections, image_base)}", slot, width, "data"))
    return out


def _thunk_name(value: int, flag: int, data: bytes, sections: list[PeSection], image_base: int) -> str:
    if value & flag:
        return f"ord_{value & 0xFFFF}"
    raw = _rva(data, sections, value & 0x7FFFFFFF, 2)
    name_rva = (value & 0x7FFFFFFF) + 2
    if raw is None:
        return f"import_{value:X}"
    return _cstr(data, sections, name_rva) or f"import_{value:X}"


def _pdata(data: bytes, sections: list[PeSection], dirs: list[tuple[int, int]], image_base: int,
           machine: int) -> list[tuple[int, int]]:
    if machine != 0x8664 or len(dirs) < 4:
        return []
    rva, size = dirs[3]
    if not rva or not size:
        return []
    out = []
    for k in range(size // 12):
        raw = _rva(data, sections, rva + 12 * k, 12)
        if raw is None:
            break
        begin, end, _unwind = struct.unpack("<III", raw)
        if begin and end > begin:
            out.append((image_base + begin, image_base + end))
    return out


# ------------------------------------------------------------------ code

def _md(arch: str) -> capstone.Cs:
    if arch == "x86":
        return capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    return capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)


def _decode(code: bytes, vram: int, arch: str, image_lo: int, image_hi: int, absolute: bool = False,
            md: capstone.Cs | None = None):
    """(text lines, insn count, refs) for a function's bytes.

    A ref is (offset of the field, relocation type, the address it points at, offset where the
    instruction ends). The relocation type uses the compiler's own numbering so it can mask the
    same bytes in a candidate object. `absolute` also takes indexed absolute operands (`arr(,%rax,4)`)
    and 32-bit immediates that point into the image (`mov $str, %edi`): non-PIC ELF code is full of both."""
    md = md or _md(arch)
    md.detail = True
    md.skipdata = True
    pc_rel = 4 if arch == "x86_64" else 20  # IMAGE_REL_AMD64_REL32 / IMAGE_REL_I386_REL32
    abs32 = 6 if arch == "x86" else 10  # IMAGE_REL_I386_DIR32 / IMAGE_REL_AMD64_ADDR32
    rip = capstone.x86.X86_REG_RIP
    lines, refs, count = [], [], 0
    for ins in md.disasm(code, vram):
        if not ins.id:
            continue
        count += 1
        end = ins.address + ins.size - vram
        e = ins.encoding
        direct = ins.group(capstone.CS_GRP_CALL) or ins.id == capstone.x86.X86_INS_JMP
        target = None
        if direct and e.imm_size and ins.operands and ins.operands[0].type == capstone.x86.X86_OP_IMM:
            value = ins.operands[0].imm
            field = ins.address - vram + e.imm_offset
            # A jump inside the function is resolved by the assembler: the candidate has no relocation there.
            if not vram < value < vram + len(code):
                target = (field, pc_rel, value, end)
        elif e.disp_size and ins.operands:
            mem = next((o.mem for o in ins.operands if o.type == capstone.x86.X86_OP_MEM), None)
            if mem is not None:
                if mem.base == rip:
                    value = ins.address + ins.size + mem.disp
                elif mem.base == 0 and (mem.index == 0 or absolute) and mem.segment == 0:
                    value = mem.disp & (0xFFFFFFFF if arch == "x86" else 0xFFFFFFFFFFFFFFFF)
                else:
                    value = None
                if value is not None and image_lo <= value < image_hi:
                    target = (ins.address - vram + e.disp_offset, abs32 if not mem.base else pc_rel, value, end)
        if target is not None:
            off, rtype, addr, fin = target
            refs.append((off, rtype, addr & 0xFFFFFFFFFFFFFFFF, fin))
        if absolute and not direct and e.imm_size == 4:
            imm = next((o.imm for o in ins.operands if o.type == capstone.x86.X86_OP_IMM), None)
            if imm is not None and image_lo <= imm < image_hi:
                refs.append((ins.address - vram + e.imm_offset, abs32, imm, end))
        lines.append(f"/* {ins.address - vram:06X} {ins.address:08X} */  {ins.mnemonic:<8} {ins.op_str}".rstrip())
    return lines, count, refs


def _padding_insn(ins: capstone.CsInsn) -> bool:
    """A no-op compilers emit to align the next function: nop, int3, `xchg ax, ax`, `lea esi, [esi]`.

    32-bit code has no table saying where a function ends, so walking a block can fall through into the
    fill that follows it; those instructions are not part of the function.
    """
    if not ins.id or ins.mnemonic in ("nop", "int3"):
        return True
    ops = ins.operands
    if ins.mnemonic == "xchg" and len(ops) == 2 and ops[0].type == capstone.x86.X86_OP_REG \
            and ops[1].type == capstone.x86.X86_OP_REG:
        return ops[0].reg == ops[1].reg
    if ins.mnemonic == "lea" and len(ops) == 2 and ops[0].type == capstone.x86.X86_OP_REG \
            and ops[1].type == capstone.x86.X86_OP_MEM:
        mem = ops[1].mem
        return mem.base == ops[0].reg and not mem.index and not mem.disp
    return False


def _trim_padding(code: bytes, arch: str) -> bytes:
    """The code up to the end of its last real instruction, without the alignment fill a block fell
    through into (`lea esi, [esi]`, `nop`); trim_code only knows single padding bytes."""
    md = _md(arch)
    md.detail = True
    md.skipdata = True
    last = 0
    for ins in md.disasm(code, 0):
        if not _padding_insn(ins):
            last = ins.address + ins.size
    return code[:last]


def _walk(code: bytes, base: int, start: int, stops: set[int], md: capstone.Cs) -> int:
    """End address of the function at `start`, by following its blocks within one section.

    Direct jumps to another known start are tail calls; every other direct jump is another block of
    this function (32-bit code has no unwind table saying where a function ends). Indirect jumps end
    the reachable code here (a jump table's blocks are found from the table's own targets).
    """
    lo, hi = base, base + len(code)
    cache: dict[int, capstone.CsInsn | None] = {}

    def at(addr: int):
        if addr not in cache:
            off = addr - lo
            # An x86 instruction is at most 15 bytes; never decode into the next function's bytes.
            ins = next(md.disasm(code[off:off + 16], addr), None) if 0 <= off < len(code) else None
            cache[addr] = ins if ins is not None and addr + ins.size <= hi else None
        return cache[addr]

    seen: set[int] = set()
    stack = [start]
    end = start
    while stack:
        addr = stack.pop()
        while lo <= addr < hi and addr not in seen:
            if addr != start and addr in stops:  # the next function starts here: never walk into it
                break
            ins = at(addr)
            if ins is None:
                break
            seen.add(addr)
            nxt = addr + ins.size
            end = max(end, nxt)
            if not ins.id or ins.mnemonic in TERMINATORS:  # data (skipdata) or the end of a block
                break
            ops = ins.operands
            target = ops[0].imm if ops and ops[0].type == capstone.x86.X86_OP_IMM else None
            if ins.mnemonic == "jmp":
                if target is None or not lo <= target < hi:
                    break
                if target != start and (target in stops or target in seen):
                    break
                addr = target
                continue
            if ins.mnemonic.startswith("j") and target is not None:
                if lo <= target < hi and target != start and target not in stops:
                    stack.append(target)
                addr = nxt
                continue
            addr = nxt
    return min(end, hi)


def read(data: bytes, name: str = "") -> PeImage:
    """Find the functions, symbols and target bytes of a Windows executable."""
    if not is_pe(data):
        raise PeError("this isn't a Windows PE executable or DLL")
    machine, arch, image_base, plus, sections, entry, dirs = _headers(data)
    symbols: list[Symbol] = []
    seen_names: set[str] = set()

    def add(sym: Symbol) -> None:
        if sym.name and sym.name not in seen_names:
            seen_names.add(sym.name)
            symbols.append(sym)

    for sym in _coff_symbols(data, sections, image_base):
        add(sym)
    for sym in _exports(data, sections, dirs, image_base):
        add(sym)
    for sym in _imports(data, sections, dirs, image_base, plus):
        add(sym)
    pdata = _pdata(data, sections, dirs, image_base, machine)
    functions, symbols, data_rows = build(data, arch, image_base, sections, symbols, pdata,
                                          image_base + entry if entry else 0)
    compiler = "MSVC" if b"Rich" in data[:0x400] and b"rsds" not in data else "MinGW-w64" \
        if any(s.name.startswith("__mingw") or s.name == "_start" for s in symbols) else "unknown"
    comment = next((s.data(data) for s in sections if s.name == ".comment"), b"")
    opt = _u32(data, 0x3C) + 24
    linker = f"{data[opt + 2]}.{data[opt + 3]:02d}" if opt + 4 <= len(data) else ""
    detected = buildinfo.analyze(data, comment=comment, linker=linker if compiler == "MSVC" else "",
                                 hint=compiler, symbols=symbols, cxx=buildinfo.looks_cxx(symbols, data))
    info = {
        "title": (name.rsplit(".", 1)[0] if name else "windows-game").replace("_", " ").strip() or "windows-game",
        "game_code": "", "region": "PC", "size": len(data), "sha1": hashlib.sha1(data).hexdigest(),
        "compiler_guess": compiler, "byte_order": "little", "entrypoint": image_base + entry if entry else 0,
        "language_guess": detected["language"], "compiler_version": detected["version"],
        "build_label": detected["label"], "matchable": detected["matchable"],
        "machine": f"{machine:04X}", "image_base": image_base, "pe32_plus": plus,
    }
    return PeImage(arch, machine, image_base, info, sections, functions, symbols, data_rows,
                   image_base + entry if entry else 0, plus)


def build(data: bytes, arch: str, image_base: int, sections: list[PeSection], symbols: list[Symbol],
          ranges: list[tuple[int, int]], entry: int, *, image_lo: int | None = None, absolute: bool = False):
    """(functions, symbols, data rows) of an x86 image, PE or ELF. `ranges` are exact function bounds (.pdata,
    .eh_frame, sized symbols); `entry` is an absolute address (0: none)."""
    image_lo = image_base if image_lo is None else image_lo
    exec_sections = [s for s in sections if s.code and s.raw_size]
    md = _md(arch)
    md.detail = True
    md.skipdata = True
    image_hi = image_base + max((s.va + max(s.size, s.raw_size) for s in sections), default=0x1000)
    pdata = ranges

    # Function starts: exception directory, symbols, exports, entry, then direct call targets.
    # A jump target is deliberately *not* a start: in 32-bit code it is usually another block of the
    # function it jumps from, and making it one cut that function in two (half the "functions" in a
    # stripped 32-bit program were such fragments). Where a function ends is found by following its
    # blocks below; jumps to another known start are tail calls.
    starts: dict[int, str] = {}
    for begin, _end in pdata:
        starts.setdefault(begin, "")
    for sym in symbols:
        if sym.kind == "func":
            starts.setdefault(sym.address, sym.name)
    if entry:
        starts.setdefault(entry, "entry" if not any(s.address == entry for s in symbols) else "")
    # .pdata is the authoritative x86-64 function table; scanning megabytes of code for direct calls is
    # only needed when it is absent (32-bit PE, or an x86-64 image with no unwind data), or cheap enough
    # to keep finding leaf functions in ordinary-sized executables.
    if not pdata or sum(s.raw_size for s in exec_sections) <= 4 << 20:
        for sec in exec_sections:
            body = sec.data(data)
            for ins in md.disasm(body, image_base + sec.va):
                if ins.id and ins.group(capstone.CS_GRP_CALL) and ins.operands \
                        and ins.operands[0].type == capstone.x86.X86_OP_IMM:
                    target = ins.operands[0].imm
                    if image_base + sec.va <= target < image_base + sec.va + len(body):
                        starts.setdefault(target, "")
    named = {s.address: s.name for s in symbols if s.kind == "func"}
    exact_sizes = {s.address: s.size for s in symbols if s.kind == "func" and s.size}
    pdata_ends = dict(pdata)

    def section_of(addr: int) -> PeSection | None:
        return next((s for s in exec_sections if image_base + s.va <= addr < image_base + s.va + s.raw_size), None)

    # Ranges are discovered in priority order, and a start inside one already found is an internal
    # entry point (a thunk, a shared cold block), not a function.
    covered: list[tuple[int, int]] = []
    covered_starts: list[int] = []

    def covered_at(addr: int) -> bool:
        i = bisect.bisect_right(covered_starts, addr) - 1
        return i >= 0 and addr < covered[i][1]

    def add_range(lo: int, hi: int) -> None:
        i = bisect.bisect_right(covered_starts, lo)
        covered_starts.insert(i, lo)
        covered.insert(i, (lo, hi))

    roots = dict(starts)
    stops = set(roots)
    priority = lambda a: (0 if a in pdata_ends else 1 if named.get(a) or a == entry else 2)  # noqa: E731
    found: list[tuple[int, int, bool]] = []
    for start in sorted(roots, key=lambda a: (priority(a), a)):
        sec = section_of(start)
        if sec is None or covered_at(start):
            continue
        sec_end = image_base + sec.va + sec.raw_size
        exact = False
        if start in pdata_ends:
            end, exact = pdata_ends[start], True
        elif start in exact_sizes:
            end, exact = start + exact_sizes[start], True
        elif sec.raw_size > WALK_LIMIT:
            # Too much code to walk: fall back to the next known start (the old, coarse boundary).
            nxt = min((r for r in roots if r > start and section_of(r) is sec), default=sec_end)
            end = nxt
        else:
            end = _walk(sec.data(data), image_base + sec.va, start, stops, md)
        # A cold block laid out after another function must not swallow it: stop at the next range
        # already claimed (ranges are added in address order only within each pass, so check them all).
        nxt_covered = bisect.bisect_right(covered_starts, start)
        end = min(end, sec_end, covered_starts[nxt_covered] if nxt_covered < len(covered_starts) else end)
        if end <= start:
            continue
        add_range(start, end)
        found.append((start, end, exact))

    # Code no root reaches (a function only named by a vtable, or called indirectly) is still a
    # function: walk every non-padding gap left in a code section, one aligned block at a time.
    for sec in exec_sections:
        if sec.raw_size > WALK_LIMIT or pdata:
            continue
        base = image_base + sec.va
        body = sec.data(data)
        lo = base
        cursor = base
        edges = [r for r in covered if base <= r[0] < lo + len(body)]
        for rlo, rhi in [*edges, (base + len(body), base + len(body))]:
            gap_lo, gap_hi = cursor, min(rlo, base + len(body))
            while gap_hi - gap_lo >= 4:
                at = gap_lo
                while at < gap_hi and body[at - base] in PADDING:
                    at += 1
                if at >= gap_hi:
                    break
                start = at
                if (start - base) % 16 and start != base and body[start - base - 1] not in PADDING:
                    break  # mid-padding junk, not an aligned function after fill
                end = _walk(body, base, start, stops | {start}, md)
                if end <= start:
                    break
                stops.add(start)
                add_range(start, end)
                found.append((start, end, False))
                gap_lo = end
            cursor = max(cursor, rhi)

    functions: list[PeFunction] = []
    for start, end, exact in sorted(found):
        sec = section_of(start)
        if sec is None:
            continue
        sec_end = image_base + sec.va + sec.raw_size
        code = data[sec.raw + start - (image_base + sec.va):sec.raw + min(end, sec_end) - (image_base + sec.va)]
        code = _trim_padding(trim_code(code, arch), arch)
        if not code:
            continue
        fname = named.get(start) or roots.get(start) or f"sub_{start:08X}"
        lines, count, refs = _decode(code, start, arch, image_lo, image_hi, absolute, md)
        asm = "\n".join([f"glabel {fname}", *lines, f"endlabel {fname}"])
        functions.append(PeFunction(fname, start, sec.raw + start - (image_base + sec.va), sec.name, code, asm, count,
                                    refs, exact))
    functions.sort(key=lambda f: f.vram)
    # Every function and every address the code refers to gets a name, the way a ROM split does. Stripped
    # executables have no symbol table at all, and agents still need a name to write in their C.
    known = {s.address for s in symbols}
    for f in functions:
        if f.vram not in known:
            symbols.append(Symbol(f.name, f.vram, len(f.code), "func"))
            known.add(f.vram)
    for f in functions:
        for _field, _type, addr, _end in f.refs:
            if image_lo <= addr < image_hi and addr not in known:
                symbols.append(Symbol(f"D_{addr:08X}", addr, 0, "data"))
                known.add(addr)

    # Data: named objects, imports, and strings worth naming for the agents.
    function_starts = [f.vram for f in functions]  # sorted: functions were emitted in address order
    for sym in symbols:
        if sym.kind == "func":
            continue
        size = sym.size
        if not size:
            i = bisect.bisect_right(function_starts, sym.address)
            nxt = function_starts[i] if i < len(function_starts) else None
            size = min(max(1, (nxt or sym.address + 16) - sym.address), 4096)
        sym.size = size
    strings: list[Symbol] = []
    for sec in sections:
        if sec.code or not sec.raw_size or sec.name.lower() not in (".rdata", ".data", ".rodata"):
            continue
        body = sec.data(data)
        for m in re.finditer(rb"[\x20-\x7e]{4,}\x00", body):
            if len(strings) >= 5000:
                break
            text = m.group(0)[:-1].decode("ascii")
            strings.append(Symbol(f"STR_{image_base + sec.va + m.start():08X}", image_base + sec.va + m.start(),
                                  len(m.group(0)), "string", text[:80]))
    symbols.extend(strings)

    data_rows = []
    for sym in symbols:
        if sym.kind == "func":
            continue
        preview = sym.preview if sym.name.startswith("STR_") else ""
        data_rows.append((sym.name, sym.address, sym.size, sym.kind, preview))
    return functions, symbols, data_rows
