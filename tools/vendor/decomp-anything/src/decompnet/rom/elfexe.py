"""Linux programs: find every function in an x86 or x86-64 ELF executable or shared library.

The same shape as pe.py (and built by its `build`), so the x86 matcher, briefs and xrefs work unchanged.
Function boundaries come from, in order of reliability:

1. the symbol table (.symtab, or .dynsym for a stripped program): sized FUNC symbols;
2. .eh_frame: a frame description for nearly every function, kept even in stripped programs;
3. the entry point and direct call targets.

Calls into shared libraries go through PLT stubs: each stub is named after the function it jumps to
(`memcpy`), and its GOT slot `memcpy@got`, so a candidate's `call memcpy` resolves where the program's does.
"""

from __future__ import annotations

import hashlib
from io import BytesIO

import capstone
from elftools.common.exceptions import ELFError
from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection
from elftools.elf.sections import SymbolTableSection

from . import buildinfo, pe
from .pe import EXECUTABLE, PeImage, PeSection
from .symbols import Symbol

MACHINES = {3: "x86", 62: "x86_64"}  # EM_386, EM_X86_64
PLT = (".plt", ".plt.sec", ".plt.got")
# Start-up code the C library links into every program: not the program's own.
CRT = {"_start", "_init", "_fini", "deregister_tm_clones", "register_tm_clones", "__do_global_dtors_aux",
       "frame_dummy", "__libc_csu_init", "__libc_csu_fini", "_dl_relocate_static_pie", "__x86.get_pc_thunk.bx"}
# Relocation types (the same numbers on both architectures): GLOB_DAT and JUMP_SLOT fill a GOT slot,
# COPY moves a library's variable (stdout, environ) into the program.
_COPY, _GLOB_DAT, _JUMP_SLOT = 5, 6, 7


class ElfError(ValueError):
    pass


def is_x86_elf(data: bytes) -> bool:
    """An x86 or x86-64 Linux program or library (not a relocatable .o)."""
    if len(data) < 0x34 or data[:4] != b"\x7fELF" or data[5] != 1:
        return False
    return int.from_bytes(data[18:20], "little") in MACHINES and int.from_bytes(data[16:18], "little") in (2, 3)


def _sections(elf: ELFFile) -> list[PeSection]:
    out = []
    for s in elf.iter_sections():
        if not s["sh_addr"] or not s.name:
            continue
        code = s["sh_flags"] & 0x4 and s.name not in PLT and s.name not in (".init", ".fini")
        raw = 0 if s["sh_type"] == "SHT_NOBITS" else s["sh_size"]
        out.append(PeSection(s.name, s["sh_addr"], s["sh_size"], raw, s["sh_offset"], EXECUTABLE if code else 0))
    return out


def _symbols(elf: ELFFile) -> tuple[list[Symbol], list[tuple[int, int]]]:
    """Defined functions and objects from .symtab and .dynsym, and the exact ranges of sized functions."""
    syms, ranges, seen = [], [], set()
    for name in (".symtab", ".dynsym"):
        tab = elf.get_section_by_name(name)
        if not isinstance(tab, SymbolTableSection):
            continue
        for s in tab.iter_symbols():
            kind = s["st_info"]["type"]
            if not s.name or s["st_shndx"] == "SHN_UNDEF" or kind not in ("STT_FUNC", "STT_OBJECT", "STT_GNU_IFUNC"):
                continue
            addr, size = s["st_value"], s["st_size"]
            if not addr or s.name in seen:
                continue
            seen.add(s.name)
            func = kind != "STT_OBJECT"
            syms.append(Symbol(s.name, addr, size, "func" if func else "data"))
            if func and size:
                ranges.append((addr, addr + size))
    return syms, ranges


def _eh_frame(elf: ELFFile) -> list[tuple[int, int]]:
    """Every function's range from its frame description: stripped programs keep these for unwinding."""
    try:
        if elf.get_section_by_name(".eh_frame") is None:
            return []
        out = []
        for entry in elf.get_dwarf_info().EH_CFI_entries():
            header = getattr(entry, "header", None)
            if header is not None and "initial_location" in header and header["address_range"]:
                out.append((header["initial_location"], header["initial_location"] + header["address_range"]))
        return out
    except Exception:  # noqa: BLE001 an odd or damaged .eh_frame: call targets still find the functions
        return []


def _imports(elf: ELFFile, arch: str, data: bytes) -> list[Symbol]:
    """Library functions by their PLT stubs, their GOT slots, and copied library variables."""
    width = 8 if arch == "x86_64" else 4
    slots: dict[int, str] = {}
    out: list[Symbol] = []
    for sec in elf.iter_sections():
        if not isinstance(sec, RelocationSection):
            continue
        try:
            symtab = elf.get_section(sec["sh_link"])
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(symtab, SymbolTableSection):
            continue
        for r in sec.iter_relocations():
            if not r["r_info_sym"]:
                continue
            sym = symtab.get_symbol(r["r_info_sym"])
            name = sym.name.split("@", 1)[0] if sym is not None else ""
            if not name:
                continue
            if r["r_info_type"] == _COPY:
                out.append(Symbol(name, r["r_offset"], sym["st_size"], "data"))
            elif r["r_info_type"] in (_GLOB_DAT, _JUMP_SLOT):
                slots[r["r_offset"]] = name
                out.append(Symbol(f"{name}@got", r["r_offset"], width, "data"))
    got = elf.get_section_by_name(".got.plt") or elf.get_section_by_name(".got")
    got_base = got["sh_addr"] if got is not None else 0
    md = pe._md(arch)
    md.detail = True
    md.skipdata = True
    named: set[str] = set()
    for name in PLT:
        sec = elf.get_section_by_name(name)
        if sec is None or not sec["sh_size"]:
            continue
        size = sec["sh_entsize"] or 16
        start = sec["sh_addr"]
        body = data[sec["sh_offset"]:sec["sh_offset"] + sec["sh_size"]]
        for ins in md.disasm(body, start):
            if ins.id != capstone.x86.X86_INS_JMP or not ins.operands or ins.operands[0].type != capstone.x86.X86_OP_MEM:
                continue
            mem = ins.operands[0].mem
            if mem.base == capstone.x86.X86_REG_RIP:
                slot = ins.address + ins.size + mem.disp
            elif mem.base == 0:
                slot = mem.disp & 0xFFFFFFFF
            elif mem.base == capstone.x86.X86_REG_EBX:  # 32-bit position-independent PLT: ebx holds the GOT
                slot = got_base + mem.disp
            else:
                continue
            target = slots.get(slot)
            if target and target not in named:
                named.add(target)
                out.append(Symbol(target, start + (ins.address - start) // size * size, size, "func"))
    return out


def _section(elf: ELFFile, name: str) -> bytes:
    sec = elf.get_section_by_name(name)
    return sec.data() if sec is not None else b""


def _compiler(elf: ELFFile) -> str:
    """What .comment says built it. The C library's start files add their own GCC line, so a clang
    line, when there is one, is the program's."""
    lines = [x.decode("utf-8", "replace").strip() for x in _section(elf, ".comment").split(b"\0") if x.strip()]
    clang = [x for x in lines if "clang" in x.lower()]
    return (clang or lines or ["unknown"])[-1][:80]


def read(data: bytes, name: str = "") -> PeImage:
    """Find the functions, symbols and target bytes of a Linux x86/x86-64 program."""
    if not is_x86_elf(data):
        raise ElfError("this isn't an x86 or x86-64 Linux program")
    try:
        elf = ELFFile(BytesIO(data))
        machine = elf["e_machine"]
        arch = MACHINES[3 if machine == "EM_386" else 62]
        sections = _sections(elf)
        defined, ranges = _symbols(elf)
        imports = _imports(elf, arch, data)
        ranges += _eh_frame(elf)
    except (ELFError, KeyError, ValueError) as e:
        raise ElfError(f"this ELF program can't be read: {e}") from e
    symbols: list[Symbol] = []
    seen: set[str] = set()
    for sym in (*defined, *imports):
        if sym.name not in seen:
            seen.add(sym.name)
            symbols.append(sym)
    entry = elf["e_entry"]
    lo = min((s.va for s in sections), default=0)
    pie = elf["e_type"] == "ET_DYN"
    # Position-independent code never encodes an address, and its addresses start near 0, where they would
    # collide with ordinary constants (`and eax, 0xfff`): only fixed-address programs look for absolute ones.
    functions, symbols, data_rows = pe.build(data, arch, 0, sections, symbols, ranges, entry, image_lo=lo,
                                             absolute=not pie)
    functions = [f for f in functions if f.name not in CRT and not (f.vram == entry and f.name == "entry")]
    detected = buildinfo.analyze(data, comment=_section(elf, ".comment"),
                                 buildinfo=_section(elf, ".go.buildinfo"),
                                 symbols=symbols, cxx=buildinfo.looks_cxx(symbols, data))
    info = {
        "title": (name.rsplit(".", 1)[0] if name.endswith((".so", ".elf", ".bin")) else name or "linux-program")
        .replace("_", " ").strip() or "linux-program",
        "game_code": "", "region": "PC", "size": len(data), "sha1": hashlib.sha1(data).hexdigest(),
        "compiler_guess": _compiler(elf), "byte_order": "little", "entrypoint": entry,
        "language_guess": detected["language"], "compiler_version": detected["version"],
        "build_label": detected["label"], "matchable": detected["matchable"],
        "machine": f"{3 if arch == 'x86' else 62:04X}", "image_base": 0, "pie": pie,
    }
    return PeImage(arch, 3 if arch == "x86" else 62, 0, info, sections, functions, symbols, data_rows, entry, False)
