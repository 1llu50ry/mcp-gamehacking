"""Matching C against code taken straight from a ROM.

The target is final, linked machine code: every address is already filled in. A candidate is a
freshly compiled object whose references are relocations against names. To compare them fairly we
*link* the candidate at the target's address:

- names (func_80001234, D_80012340, or anything renamed in the symbol table) resolve to addresses;
- jumps inside the function resolve against the function's own address;
- data the candidate defines itself (string literals, float constants, jump tables, statics) is
  placed where the ROM keeps the data this instruction refers to, and its contents are checked
  against the ROM bytes there (relocated words, like jump table entries, included).

A match means the linked candidate is byte-for-byte the code in the ROM. For the diff the agent
reads, both sides are shown with the same names (the symbol table's names for those addresses).
"""

from __future__ import annotations

import re
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from io import BytesIO

from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection

from .. import scoring
from ..elfobj import _MASKS, FunctionObj, Reloc, _canonical, _section_target, _symbol_at
from .split import RomFunction
from .symbols import SymbolTable

R_MIPS_32, R_MIPS_26, R_MIPS_HI16, R_MIPS_LO16, R_MIPS_GPREL16 = 2, 4, 5, 6, 7
_REF = re.compile(r"%(hi|lo|gp_rel)\(\s*([A-Za-z_.$][\w.$]*)\s*(?:([+-])\s*(0x[0-9A-Fa-f]+|\d+))?\s*\)")
_KIND = {"hi": 5, "lo": 6, "gp_rel": 7}
_JUMPS = {"jal", "j"}
# Bytes a load or store moves, by opcode (lwl/lwr/swl/swr read parts of words, so they don't say)
_WIDTH = {0x20: 1, 0x24: 1, 0x28: 1, 0x21: 2, 0x25: 2, 0x29: 2, 0x23: 4, 0x27: 4, 0x2B: 4, 0x31: 4, 0x39: 4, 0x32: 4,
          0x3A: 4, 0x35: 8, 0x3D: 8, 0x37: 8, 0x3F: 8, 0x1E: 16, 0x1F: 16, 0x36: 16, 0x3E: 16}

ReadFn = Callable[[int, int], "bytes | None"]


@dataclass
class RomTarget:
    name: str
    vram: int
    code: bytes
    relocs: list[tuple[int, int, int]]  # (offset in function, reloc type, absolute address)
    big_endian: bool = True
    gp: int = 0  # $gp, for $gp-relative references (PlayStation small data)

    @property
    def order(self) -> str:
        return "big" if self.big_endian else "little"

    def to_json(self) -> list:
        return [list(r) for r in self.relocs]

    @staticmethod
    def relocs_from_json(v: list) -> list[tuple[int, int, int]]:
        return [tuple(r) for r in v]


@dataclass
class LinkResult:
    candidate: FunctionObj | None  # canonical form, for the diff
    exact: bool
    problems: list[str] = field(default_factory=list)
    # data the candidate defines itself, as placed at the game's copy: section name -> {offset: address}
    placements: dict[str, dict[int, int]] = field(default_factory=dict)


def encode(rtype: int, residual: int) -> int:
    """The relocation field an assembler writes for `symbol + residual` (REL, MIPS)."""
    if rtype == R_MIPS_26:
        return (residual >> 2) & 0x03FFFFFF
    if rtype == R_MIPS_HI16:
        return ((residual + 0x8000) >> 16) & 0xFFFF
    if rtype == R_MIPS_LO16:
        return residual & 0xFFFF
    return residual & 0xFFFFFFFF


def _patch(word: int, rtype: int, address: int, gp: int = 0) -> int:
    if rtype == R_MIPS_GPREL16:
        return (word & ~0xFFFF) | ((address - gp) & 0xFFFF)
    if rtype == R_MIPS_26:
        return (word & ~0x03FFFFFF) | ((address >> 2) & 0x03FFFFFF)
    if rtype == R_MIPS_HI16:
        return (word & ~0xFFFF) | (((address + 0x8000) >> 16) & 0xFFFF)
    if rtype == R_MIPS_LO16:
        return (word & ~0xFFFF) | (address & 0xFFFF)
    if rtype == R_MIPS_32:
        return address & 0xFFFFFFFF
    raise ValueError(rtype)


def _text(data: bytes) -> bool:
    return bool(data) and all(32 <= c < 127 or c in (9, 10, 13, 27) or c >= 0x80 for c in data)


def significant(mine: bytes, addr: int, width: int | None, next_start: Callable[[int], int | None]) -> int:
    """How many bytes of a datum the candidate defines (placed at the game's `addr`) must equal the game's.

    `width`: the bytes the code loads from it, when it only loads (a float, a word); that's all that counts.
    Otherwise (its address is used: a string, a table) the whole datum counts except alignment padding: zeros
    at its end where the game already keeps its next datum (`next_start(a)`: the first labelled address >= a),
    or after a C string's terminator. A compiler pads the same data differently next to other data."""
    if width:
        return min(len(mine), width)
    k = len(mine.rstrip(b"\0"))
    if k + 1 >= len(mine):
        return len(mine)
    nxt = next_start(addr + k + 1)  # past the last non-zero byte and one zero (a string's terminator)
    if nxt is not None and nxt < addr + len(mine):
        return nxt - addr
    if _text(mine[:k]):
        return k + 1
    return len(mine)


# ----------------------------------------------------------------------------------- target

def target_from_split(fn: RomFunction, resolve: Callable[[str], int | None], big_endian: bool = True,
                      gp: int = 0) -> RomTarget:
    """The function's bytes from the ROM plus the address behind every annotated reference."""
    code = b"".join(ln.word.to_bytes(4, "big" if big_endian else "little") for ln in fn.lines)
    relocs: list[tuple[int, int, int]] = []
    for ln in fn.lines:
        off = ln.vram - fn.vram
        m = _REF.search(ln.operands)
        if m:
            kind, sym, sign, num = m.groups()
            base = resolve(sym)
            if base is not None:
                addend = (int(num, 0) if num else 0) * (-1 if sign == "-" else 1)
                relocs.append((off, _KIND[kind], (base + addend) & 0xFFFFFFFF))
            continue
        if ln.mnemonic in _JUMPS:
            op = ln.operands.strip()
            if op.startswith((".L", "L")):
                addr = int(op.lstrip(".L"), 16)
            else:
                addr = resolve(op)
                if addr is None:
                    addr = ((ln.vram + 4) & 0xF0000000) | ((ln.word & 0x03FFFFFF) << 2)
            relocs.append((off, R_MIPS_26, addr))
    return RomTarget(fn.name, fn.vram, code, relocs, big_endian, gp)


def canonical_target(t: RomTarget, symbols: SymbolTable) -> FunctionObj:
    relocs = []
    for off, rtype, addr in t.relocs:
        name, residual = symbols.name_at(addr)
        if t.vram <= addr < t.vram + len(t.code):
            name, residual = t.name, addr - t.vram
        relocs.append(Reloc(off, rtype, name, encode(rtype, residual)))
    return FunctionObj(t.name, "mips", t.big_endian, t.code, relocs)


# -------------------------------------------------------------------------------- candidate

def _raw_relocs(elf: ELFFile, shndx: int, start: int, size: int, code: bytes) -> list[dict]:
    order = "little" if elf.little_endian else "big"
    raw = []
    for rsec in elf.iter_sections():
        if not isinstance(rsec, RelocationSection) or rsec["sh_info"] != shndx:
            continue
        symtab = elf.get_section(rsec["sh_link"])
        for rel in rsec.iter_relocations():
            off = rel["r_offset"]
            if not (start <= off < start + size):
                continue
            rtype = rel["r_info_type"]
            if rel.is_RELA():
                value = rel["r_addend"]
            else:
                delta, length, mask = _MASKS.get(("mips", rtype), (0, 4, 0xFFFFFFFF))
                at = off - start + delta
                value = int.from_bytes(code[at:at + length], order) & mask
            raw.append({"off": off - start, "type": rtype, "symidx": rel["r_info_sym"], "rela": rel.is_RELA(),
                        "value": value, "symtab": symtab})
    raw.sort(key=lambda r: r["off"])
    return raw


class _Linker:
    def __init__(self, obj: bytes, name: str, target: RomTarget, symbols: SymbolTable, read: ReadFn):
        self.elf = ELFFile(BytesIO(obj))
        self.name, self.target, self.symbols, self.read = name, target, symbols, read
        self.symtab = self.elf.get_section_by_name(".symtab")
        self.problems: list[str] = []
        self.local_map: dict[tuple[int, int], int] = {}  # (section index, offset) -> ROM address
        self.target_at = {off: (rtype, addr) for off, rtype, addr in target.relocs}
        self.data: dict[tuple[int, int], int] = {}  # every datum of its own the candidate uses -> ROM address
        self.widths: dict[tuple[int, int], int | None] = {}  # bytes the code loads from it (None: its address is used)
        self._data_relocs: dict[int, list] = {}
        self.words: list[int] = []
        self.fn_shndx = None

    def problem(self, text: str) -> None:
        if text not in self.problems:
            self.problems.append(text)

    def function(self) -> tuple[int, int, int] | None:
        """(section index, offset, size) of the submitted function, also for period assemblers' size-0 symbols."""
        from ..elfobj import _function_symbols

        return _function_symbols(self.elf).get(self.name)

    def resolve_name(self, name: str) -> int | None:
        addr = self.symbols.resolve(name)
        if addr is None:
            self.problem(f"`{name}` is not a known symbol. Use the name the assembly shows (like D_80012340 or "
                         f"func_80001234), or give that address this name first with rename_symbol.")
        return addr

    def address(self, raw: list[dict], k: int, fn_shndx: int, fn_start: int) -> int | None:
        r = raw[k]
        if r["type"] == R_MIPS_GPREL16:
            residual = r["value"] - 0x10000 if r["value"] & 0x8000 else r["value"]
        else:
            residual = _section_target("mips", raw, k)
        if residual is None:
            self.problem(f"relocation type {r['type']} is not supported here")
            return None
        if r["type"] == R_MIPS_GPREL16 and not self.target.gp:
            self.problem("your code uses $gp-relative data, but this game doesn't: compile with -G0")
            return None
        sym = r["symtab"].get_symbol(r["symidx"])
        shndx = sym["st_shndx"]
        if shndx in ("SHN_UNDEF", "SHN_COMMON") or shndx in (0xFF03, 0xFF04):  # + MIPS small common / small undefined
            base = self.resolve_name(_canonical(sym.name, sym["st_info"]["bind"]))
            return None if base is None else (base + residual) & 0xFFFFFFFF
        off = residual if sym["st_info"]["type"] == "STT_SECTION" else sym["st_value"] + residual
        named = _symbol_at(self.symtab, shndx, off)
        if shndx == fn_shndx:
            if named and named[0] == self.name:
                return self.target.vram + named[1]
            if named is None:
                self.problem(f"a jump into .text+0x{off:X} that isn't part of {self.name}")
                return None
            base = self.resolve_name(named[0])
            return None if base is None else base + named[1]
        # data this submission defines itself: place it where the ROM keeps the data this instruction uses
        base = self.symbols.resolve(named[0]) if named else None
        if base is not None:
            addr = base + named[1]
        else:
            want = self.target_at.get(r["off"])
            if want is None or want[0] != r["type"]:
                label = f"{named[0]}+0x{named[1]:X}" if named else f"{self.elf.get_section(shndx).name}+0x{off:X}"
                self.problem(f"your code refers to {label} where the ROM's code has no address")
                return None
            addr = want[1]
            prev = self.local_map.setdefault((shndx, off), addr)
            if prev != addr:
                self.problem(f"{self.elf.get_section(shndx).name}+0x{off:X} is used for two different ROM addresses")
                return None
        self.data.setdefault((shndx, off), addr)
        if r["type"] != R_MIPS_HI16:  # the instruction that uses the address says how much of the data it reads
            width = _WIDTH.get(self.words[r["off"] // 4] >> 26) if r["off"] // 4 < len(self.words) else None
            prev_width = self.widths.get((shndx, off), 0)
            self.widths[(shndx, off)] = None if width is None or prev_width is None else max(prev_width, width)
        return addr

    # ------------------------------------------------------------------ the candidate's own data

    def _relocs_in(self, shndx: int):
        """(offset, type, symbol) of relocations inside one of the candidate's data sections."""
        if shndx not in self._data_relocs:
            out = []
            for rsec in self.elf.iter_sections():
                if isinstance(rsec, RelocationSection) and rsec["sh_info"] == shndx:
                    rsym = self.elf.get_section(rsec["sh_link"])
                    out += [(rel["r_offset"], rel["r_info_type"], rsym.get_symbol(rel["r_info_sym"]))
                            for rel in rsec.iter_relocations()]
            self._data_relocs[shndx] = sorted(out, key=lambda x: x[0])
        return self._data_relocs[shndx]

    def extent(self, shndx: int, off: int) -> int:
        """Length of the datum at `off`: up to the next symbol or the next place this candidate uses (period
        assemblers don't record sizes; string literals have no symbol at all)."""
        sec = self.elf.get_section(shndx)
        size = sec["sh_size"]
        sym = next((s for s in self.symtab.iter_symbols() if s["st_shndx"] == shndx and s["st_value"] == off
                    and s["st_size"] and s["st_info"]["type"] == "STT_OBJECT"), None)
        if sym is not None:
            return max(0, min(sym["st_size"], size - off))
        bounds = {s["st_value"] for s in self.symtab.iter_symbols() if s["st_shndx"] == shndx
                  and s["st_info"]["type"] not in ("STT_SECTION", "STT_FILE")} | {o for (i, o) in self.data if i == shndx}
        return next((b for b in sorted(bounds) if b > off), size) - off

    def _pointee(self, s, value: int) -> tuple[int | None, tuple[int, int] | None]:
        """(address, own datum) a word of the candidate's data points at: (address, None) for a named thing,
        (None, (section, offset)) for more of the candidate's own data, (None, None) when it can't be placed."""
        if s["st_shndx"] in ("SHN_UNDEF", "SHN_COMMON") or s["st_shndx"] in (0xFF03, 0xFF04):
            base = self.resolve_name(_canonical(s.name, s["st_info"]["bind"]))
            return (None if base is None else base + value), None
        in_sec = value if s["st_info"]["type"] == "STT_SECTION" else s["st_value"] + value
        hit = _symbol_at(self.symtab, s["st_shndx"], in_sec)
        if hit and hit[0] == self.name:
            return self.target.vram + hit[1], None
        base = self.symbols.resolve(hit[0]) if hit else None
        if base is not None:
            return base + hit[1], None
        if s["st_shndx"] == self.fn_shndx:
            return None, None
        return None, (s["st_shndx"], in_sec)

    def place_pointees(self) -> None:
        """Data the candidate's data points at (a table of strings) goes where the ROM's pointers point."""
        todo = list(self.data)
        while todo:
            shndx, off = todo.pop()
            if self.elf.get_section(shndx)["sh_type"] == "SHT_NOBITS":
                continue
            addr, length = self.data[(shndx, off)], self.extent(shndx, off)
            data = self.elf.get_section(shndx).data()
            for at, rtype, s in self._relocs_in(shndx):
                if rtype != R_MIPS_32 or not off <= at <= off + length - 4:
                    continue
                _, own = self._pointee(s, int.from_bytes(data[at:at + 4], self.target.order))
                if own is None or own in self.data or (rom := self.read(addr + at - off, 4)) is None:
                    continue
                self.local_map[own] = self.data[own] = int.from_bytes(rom, self.target.order)
                self.widths[own] = None
                todo.append(own)

    def significant(self, mine: bytes, addr: int, width: int | None) -> int:
        starts = [*self.data.values(), *(a for _, a in self.target_at.values())]
        return significant(mine, addr, width, lambda lo: min(
            [a for a in (self.symbols.next_after(lo - 1), *starts) if a is not None and a >= lo], default=None))

    def verify_data(self, shndx: int, off: int, addr: int) -> None:
        """Data the candidate defines must be identical to the ROM data it stands for."""
        sec = self.elf.get_section(shndx)
        if sec["sh_type"] == "SHT_NOBITS":
            return
        length = self.extent(shndx, off)
        if length <= 0:
            return
        mine = bytearray(sec.data()[off:off + length])
        for at, rtype, s in self._relocs_in(shndx):  # relocated words inside the data, e.g. jump tables
            at -= off
            if rtype != R_MIPS_32 or not 0 <= at <= length - 4:
                continue
            dest, own = self._pointee(s, int.from_bytes(mine[at:at + 4], self.target.order))
            if own is not None:
                dest = self.local_map.get(own)
            if dest is None:
                self.problem(f"can't place a pointer inside your data at {sec.name}+0x{off + at:X}")
                return
            mine[at:at + 4] = (dest & 0xFFFFFFFF).to_bytes(4, self.target.order)
        n = self.significant(bytes(mine), addr, self.widths.get((shndx, off)))
        rom = self.read(addr, n)
        if rom is None:
            return  # the ROM has no bytes there (e.g. .bss in the ROM): nothing to compare
        if bytes(mine[:n]) != rom:
            where = self.symbols.label(addr)
            self.problem(f"your data for {where} differs from the ROM: yours {bytes(mine[:min(n, 24)]).hex(' ')}"
                         f"{'…' if n > 24 else ''}, ROM {rom[:24].hex(' ')}{'…' if n > 24 else ''}")

    def run(self) -> LinkResult:
        fsym = self.function()
        if fsym is None:
            return LinkResult(None, False, [f"the object has no function named `{self.name}`"])
        shndx, start, size = fsym
        self.fn_shndx = shndx
        code = self.elf.get_section(shndx).data()[start:start + size]
        raw = _raw_relocs(self.elf, shndx, start, size, code)
        if self.elf.little_endian == self.target.big_endian:
            return LinkResult(None, False, ["the compiler produced code in the wrong byte order for this game"])
        fmt = (">" if self.target.big_endian else "<") + f"{len(code) // 4}I"
        words = list(struct.unpack(fmt, code[:len(code) // 4 * 4]))
        self.words = list(words)
        relocs: list[Reloc] = []
        for k, r in enumerate(raw):
            addr = self.address(raw, k, shndx, start)
            if addr is None:
                sym = r["symtab"].get_symbol(r["symidx"])
                relocs.append(Reloc(r["off"], r["type"], f"?{sym.name or 'local'}", 0))
                continue
            i = r["off"] // 4
            if i < len(words):
                words[i] = _patch(words[i], r["type"], addr, self.target.gp)
            name, residual = self.symbols.name_at(addr)
            if self.target.vram <= addr < self.target.vram + len(self.target.code):
                name, residual = self.name, addr - self.target.vram
            relocs.append(Reloc(r["off"], r["type"], name, encode(r["type"], residual)))
        # every place is known before any datum is measured: a datum runs to the next one, whatever the code's order
        self.place_pointees()
        for (dshndx, off), addr in sorted(self.data.items()):
            self.verify_data(dshndx, off, addr)
        linked = struct.pack(fmt[0] + f"{len(words)}I", *words)
        exact = not self.problems and linked == self.target.code
        placements: dict[str, dict[int, int]] = {}
        for (dshndx, off), addr in self.local_map.items():
            placements.setdefault(self.elf.get_section(dshndx).name, {})[off] = addr
        return LinkResult(FunctionObj(self.name, "mips", self.target.big_endian, code, relocs), exact, self.problems,
                          placements)


def link(obj: bytes, name: str, target: RomTarget, symbols: SymbolTable, read: ReadFn) -> LinkResult:
    """Link a compiled candidate at the target's address and compare it with the ROM."""
    return _Linker(obj, name, target, symbols, read).run()


def diff(target: FunctionObj, result: LinkResult) -> scoring.DiffResult:
    """Score with the usual instruction diff, but decide the match by the linked bytes."""
    d = scoring.diff(target, result.candidate)
    if result.exact:
        return scoring.DiffResult(0, d.max_score, d.rows, True)
    return scoring.DiffResult(max(1, d.score), d.max_score, d.rows, False)
