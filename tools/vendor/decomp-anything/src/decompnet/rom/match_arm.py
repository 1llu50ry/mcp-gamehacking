"""Link a compiled ARM/Thumb function at its address in the ROM and compare it with the original, byte for byte.

Like match.py for MIPS, but without relocations from a disassembler: for each relocation in the candidate, the
original's bytes at the same place say what it refers to (a Thumb `bl` encodes its destination, a literal-pool word
holds an address). The candidate must refer to the same thing: a function or variable by name (sub_08001234,
gUnknown_03001234 or a name given with rename_symbol), or data it defines itself, which is then checked against
the ROM's copy where that's in ROM. Everything else must be identical.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection

from ..elfobj import FunctionObj, Reloc, _function_symbols
from .match import LinkResult, significant
from .symbols import SymbolTable

R_ARM_PC24, R_ARM_ABS32, R_ARM_THM_CALL, R_ARM_CALL, R_ARM_JUMP24, R_ARM_V4BX = 1, 2, 10, 28, 29, 40


@dataclass
class ArmTarget:
    name: str
    vram: int
    code: bytes
    thumb: bool = True


def thumb_bl_dest(code: bytes, at: int, pc: int) -> int | None:
    """Destination of a Thumb `bl` pair at code[at:at+4] located at address pc."""
    h1 = int.from_bytes(code[at:at + 2], "little")
    h2 = int.from_bytes(code[at + 2:at + 4], "little")
    if (h1 & 0xF800) != 0xF000 or (h2 & 0xE800) != 0xE800:
        return None
    hi = h1 & 0x7FF
    if hi & 0x400:
        hi -= 0x800
    return (pc + 4 + (hi << 12) + ((h2 & 0x7FF) << 1)) & 0xFFFFFFFF


def arm_b_dest(code: bytes, at: int, pc: int) -> int | None:
    word = int.from_bytes(code[at:at + 4], "little")
    if (word >> 25) & 7 != 5:
        return None
    imm = word & 0xFFFFFF
    if imm & 0x800000:
        imm -= 0x1000000
    return (pc + 8 + (imm << 2)) & 0xFFFFFFFF


def _sym_name(elf: ELFFile, symtab, idx: int):
    sym = symtab.get_symbol(idx)
    if sym["st_info"]["type"] == "STT_SECTION":
        return elf.get_section(sym["st_shndx"]).name, sym, True
    return sym.name, sym, False


def _defined(sym) -> bool:
    return isinstance(sym["st_shndx"], int) and sym["st_shndx"] != 0


def link(obj: bytes, name: str, target: ArmTarget, symbols: SymbolTable, read) -> LinkResult:
    elf = ELFFile(BytesIO(obj))
    found = _function_symbols(elf).get(name)
    if found is None:
        return LinkResult(None, False, [f"the object has no function named `{name}`"])
    shndx, start, size = found
    start &= ~1  # Thumb functions have the low bit set
    section = elf.get_section(shndx)
    code = bytearray(section.data()[start:start + size])
    problems: list[str] = []
    relocs: list[Reloc] = []
    tcode = target.code
    own: dict[tuple[int, int], int] = {}  # data the candidate defines itself: (section, offset) -> the original's address
    symtab_all = elf.get_section_by_name(".symtab")

    def problem(text: str) -> None:
        if text not in problems:
            problems.append(text)

    def place(key: tuple[int, int], original: int) -> None:
        if own.setdefault(key, original) != original:
            problem(f"{elf.get_section(key[0]).name}+0x{key[1]:X} is used for two different addresses in the original")

    for rsec in elf.iter_sections():
        if not isinstance(rsec, RelocationSection) or rsec["sh_info"] != shndx:
            continue
        symtab = elf.get_section(rsec["sh_link"])
        for rel in rsec.iter_relocations():
            at = rel["r_offset"] - start
            if not 0 <= at < len(code):
                continue
            rtype = rel["r_info_type"]
            if rtype == R_ARM_V4BX:
                continue
            sname, sym, is_section = _sym_name(elf, symtab, rel["r_info_sym"])
            relocs.append(Reloc(at, rtype, sname, 0))
            pc = target.vram + at
            if at + 4 > len(tcode):
                problem("your function is longer than the original")
                continue
            if rtype == R_ARM_ABS32:
                addend = int.from_bytes(code[at:at + 4], "little")
                original = int.from_bytes(tcode[at:at + 4], "little")
                if _defined(sym) and sym["st_shndx"] == shndx:  # a pointer into this function (a switch's jump table)
                    inner = (0 if is_section else (sym["st_value"] & ~1)) + addend - start
                    if (target.vram + inner) & 0xFFFFFFFF != original & ~1 and (target.vram + inner) != original:
                        problem(f"a pointer to your function +0x{inner:X} where the original points at 0x{original:08X}")
                elif not _defined(sym) or (not is_section and symbols.resolve(sname) is not None):
                    base = symbols.resolve(sname)
                    if base is None:
                        problem(f"`{sname}` is not a known symbol. Use the name the assembly shows (like sub_08001234 "
                                f"or gUnknown_03001234), or give that address this name first with rename_symbol.")
                        continue
                    if (base + addend) & 0xFFFFFFFF != original and ((base + addend) | 1) & 0xFFFFFFFF != original:
                        problem(f"a pointer to {sname}{f'+0x{addend:X}' if addend else ''} where the original has "
                                f"0x{original:08X} ({symbols.label(original)})")
                else:  # data this function defines itself (a string, a table): the original's copy is at `original`
                    place((sym["st_shndx"], addend + (0 if is_section else sym["st_value"])), original)
                code[at:at + 4] = tcode[at:at + 4]
            elif rtype == R_ARM_THM_CALL:
                dest = thumb_bl_dest(tcode, at, pc)
                base = symbols.resolve(sname)
                if base is None:
                    problem(f"`{sname}` is not a known function. Call it by the name the assembly shows (like "
                            f"sub_08001234), or give that address this name first with rename_symbol.")
                    continue
                if dest is None or (dest & ~1) != (base & ~1):
                    problem(f"you call {sname} where the original calls "
                            f"{symbols.label(dest) if dest is not None else 'something else'}")
                    continue
                code[at:at + 4] = tcode[at:at + 4]
            elif rtype in (R_ARM_PC24, R_ARM_CALL, R_ARM_JUMP24):
                dest = arm_b_dest(tcode, at, pc)
                base = symbols.resolve(sname)
                if base is None or dest is None or (dest & ~1) != (base & ~1):
                    problem(f"you branch to {sname} where the original goes to "
                            f"{symbols.label(dest) if dest is not None else 'something else'}")
                    continue
                code[at:at + 4] = tcode[at:at + 4]
            else:
                problem(f"relocation type {rtype} isn't supported yet")

    _verify_own(elf, symtab_all, name, shndx, start, target, symbols, read, own, problem)
    placements: dict[str, dict[int, int]] = {}
    for (sec_idx, offset), original in own.items():
        placements.setdefault(elf.get_section(sec_idx).name, {})[offset] = original
    linked = bytes(code)
    exact = not problems and linked == tcode[:len(linked)] and len(linked) == len(tcode)
    return LinkResult(FunctionObj(name, "thumb" if target.thumb else "arm", False, linked, []), exact, problems,
                      placements)


def _verify_own(elf: ELFFile, symtab, name: str, fn_shndx: int, fn_start: int, target: ArmTarget, symbols: SymbolTable,
                read, own: dict, problem) -> None:
    """The data the candidate defines itself must be the original's: placed where the original's code points, each
    datum compared up to the next one (after every place is known), pointers inside it (a table of strings)
    followed to where the original's pointers point."""
    data_relocs: dict[int, list] = {}

    def relocs_in(sec_idx: int) -> list:
        if sec_idx not in data_relocs:
            out = []
            for rsec in elf.iter_sections():
                if isinstance(rsec, RelocationSection) and rsec["sh_info"] == sec_idx:
                    rsym = elf.get_section(rsec["sh_link"])
                    out += [(rel["r_offset"], rel["r_info_type"], rsym.get_symbol(rel["r_info_sym"]))
                            for rel in rsec.iter_relocations()]
            data_relocs[sec_idx] = out
        return data_relocs[sec_idx]

    def extent(sec_idx: int, off: int) -> int:
        size = elf.get_section(sec_idx)["sh_size"]
        bounds = {s["st_value"] for s in symtab.iter_symbols() if s["st_shndx"] == sec_idx
                  and s["st_info"]["type"] not in ("STT_SECTION", "STT_FILE") and not s.name.startswith("$")}
        bounds |= {o for (i, o) in own if i == sec_idx}
        return next((b for b in sorted(bounds) if b > off), size) - off

    def pointee(s, value: int) -> tuple[int | None, tuple[int, int] | None]:
        sname = elf.get_section(s["st_shndx"]).name if s["st_info"]["type"] == "STT_SECTION" else s.name
        if not _defined(s) or (s["st_info"]["type"] != "STT_SECTION" and symbols.resolve(sname) is not None):
            base = symbols.resolve(sname)
            return (None if base is None else (base + value) & 0xFFFFFFFF), None
        in_sec = value + (0 if s["st_info"]["type"] == "STT_SECTION" else s["st_value"])
        if s["st_shndx"] == fn_shndx:
            return (target.vram + (in_sec & ~1) - fn_start) & 0xFFFFFFFF, None
        return None, (s["st_shndx"], in_sec)

    def in_rom(sec_idx: int) -> bool:
        return elf.get_section(sec_idx)["sh_type"] != "SHT_NOBITS"

    todo = list(own)
    while todo:  # pointers inside the data lead to more of it
        sec_idx, off = todo.pop()
        if not in_rom(sec_idx):
            continue
        addr, length, data = own[(sec_idx, off)], extent(sec_idx, off), elf.get_section(sec_idx).data()
        for at, rtype, s in relocs_in(sec_idx):
            if rtype != R_ARM_ABS32 or not off <= at <= off + length - 4:
                continue
            _, key = pointee(s, int.from_bytes(data[at:at + 4], "little"))
            if key is None or key in own or (word := read(addr + at - off, 4)) is None:
                continue
            own[key] = int.from_bytes(word, "little")
            todo.append(key)

    def next_start(lo: int) -> int | None:
        found = [a for a in (symbols.next_after(lo - 1), *own.values()) if a is not None and a >= lo]
        return min(found, default=None)

    for (sec_idx, off), addr in sorted(own.items()):
        if not in_rom(sec_idx):
            continue
        length = extent(sec_idx, off)
        sec = elf.get_section(sec_idx)
        mine = bytearray(sec.data()[off:off + length])
        if not mine:
            continue
        unplaced = False
        for at, rtype, s in relocs_in(sec_idx):
            at -= off
            if rtype != R_ARM_ABS32 or not 0 <= at <= length - 4:
                continue
            dest, key = pointee(s, int.from_bytes(mine[at:at + 4], "little"))
            if key is not None:
                dest = own.get(key)
            if dest is None:
                problem(f"can't place a pointer inside your data at {sec.name}+0x{off + at:X}")
                unplaced = True
                break
            word = read(addr + at, 4)
            if word is not None and (int.from_bytes(word, "little") & ~1) == (dest & ~1):
                dest = int.from_bytes(word, "little")  # a Thumb function's address has its low bit set
            mine[at:at + 4] = (dest & 0xFFFFFFFF).to_bytes(4, "little")
        if unplaced:
            continue
        n = significant(bytes(mine), addr, None, next_start)
        rom = read(addr, n)
        if rom is not None and rom != bytes(mine[:n]):
            problem(f"your {sec.name} data at +0x{off:X} differs from the original's at 0x{addr:08X} "
                    f"({symbols.label(addr)}): yours {bytes(mine[:min(n, 24)]).hex(' ')}"
                    f"{'…' if n > 24 else ''}, original {rom[:24].hex(' ')}{'…' if n > 24 else ''}")
