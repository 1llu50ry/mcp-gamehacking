"""Compare a compiled Windows function with its original bytes.

Both sides say which byte fields an address is encoded in: the target from decoding the original
(call/jump displacements, RIP-relative operands, absolute addresses), the candidate from the
object file's COFF (or ELF) relocations. Those fields are blanked on both sides and compared;
each candidate relocation then has to resolve to the address the original field points at.

That is the same idea as match.py's linker for MIPS, without needing a full link: Windows
compilers write addresses PC-relative, so the displacement is always the distance to a symbol
the target's own symbol table can name.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..coffobj import extract_function as coff_function
from ..coffobj import is_coff
from ..elfobj import FunctionObj, Reloc
from ..elfobj import extract_function as elf_function
from .match import LinkResult
from .symbols import SymbolTable

# Relocation types (ELF and COFF share the two encodings the matcher needs to distinguish):
# a PC-relative displacement or an absolute address.
_REL = {"x86_64": {2, 4, 5, 6, 7, 8, 9, 41, 42}, "x86": {2, 4, 20}}
_ABS = {"x86_64": {1, 10, 11}, "x86": {1, 6, 7, 11}}
# ELF relocations through the GOT (R_X86_64_GOTPCREL, GOTPCRELX, REX_GOTPCRELX): they point at the
# symbol's slot, named `<symbol>@got` by elfexe.py.
_GOT = {"x86_64": {9, 41, 42}, "x86": set()}
_FIELD_SIZE = {("x86_64", 1): 8, ("x86_64", 2): 4, ("x86_64", 4): 4, ("x86_64", 5): 4, ("x86_64", 6): 4,
         ("x86_64", 7): 4, ("x86_64", 8): 4, ("x86_64", 9): 4, ("x86_64", 10): 4, ("x86_64", 11): 4,
         ("x86", 1): 4, ("x86", 2): 4, ("x86", 4): 4, ("x86", 6): 4, ("x86", 7): 4, ("x86", 11): 4, ("x86", 20): 4}


@dataclass
class X86Target:
    name: str
    arch: str
    code: bytes
    relocs: list[tuple[int, int, int, int]]  # (field offset, type, address, instruction end)

    @property
    def endian(self) -> str:
        return "little"

    def to_json(self) -> list:
        return [list(r) for r in self.relocs]

    @staticmethod
    def relocs_from_json(v: list) -> list[tuple[int, int, int, int]]:
        return [(int(r[0]), int(r[1]), int(r[2]), int(r[3]) if len(r) > 3 else int(r[0]) + 4) for r in v]


def target_obj(t: X86Target, symbols: SymbolTable) -> FunctionObj:
    """The target as a FunctionObj, so scoring.diff can show the instruction diff and symbol names.

    disassemble() renders a PC-relative reloc as `symbol + (addend + instruction end - field)`, so
    the addend is chosen to make that the symbol's own offset from its address."""
    relocs = []
    for field, rtype, addr, _ in t.relocs:
        name, delta = symbols.name_at(addr)
        relocs.append(Reloc(field, rtype, name, delta))
    return FunctionObj(t.name, t.arch, False, t.code, relocs, format="coff")


def target_from_function(fn, proj_config: dict | None = None) -> X86Target:
    relocs = X86Target.relocs_from_json(json.loads(fn["relocs"] or "[]"))
    return X86Target(fn["name"], proj_config.get("arch", "x86_64") if proj_config else "x86_64", fn["target"], relocs)


def _field_size(arch: str, rtype: int) -> int:
    return _FIELD_SIZE.get((arch, rtype), 4)


def _field(code: bytes, off: int, size: int) -> int:
    return int.from_bytes(code[off:off + size], "little")


def _mask(code: bytes, relocs, arch: str) -> bytes:
    buf = bytearray(code)
    for r in relocs:
        off = r[0] if isinstance(r, tuple) else r.offset
        rtype = r[1] if isinstance(r, tuple) else r.type
        size = _field_size(arch, rtype)
        if off >= 0 and off + size <= len(buf):
            buf[off:off + size] = b"\0" * size
    return bytes(buf)


def _resolve(symbols: SymbolTable, name: str) -> int | None:
    for candidate in (name, name.lstrip("_"), name.split("@", 1)[0], name.lstrip("_").split("@", 1)[0]):
        value = symbols.resolve(candidate)
        if value is not None:
            return value
    if name.startswith((".text$", ".data$", ".rdata$", ".bss$")):
        return symbols.resolve(name.split("$", 1)[1])
    return None


def link(obj: bytes, name: str, target: X86Target, symbols: SymbolTable) -> LinkResult:
    candidate = coff_function(obj, name) if is_coff(obj) else elf_function(obj, name)
    if candidate is None:
        return LinkResult(None, False, [f"the object has no function named `{name}`"])
    problems: list[str] = []
    if candidate.arch != target.arch:
        return LinkResult(candidate, False, [f"your object is {candidate.arch} code, the game is {target.arch}"])
    if len(candidate.code) != len(target.code):
        problems.append(f"your function is {len(candidate.code)} bytes, the original is {len(target.code)}")
    mine, theirs = _mask(candidate.code, [(r.offset, r.type) for r in candidate.relocs], target.arch), \
        _mask(target.code, target.relocs, target.arch)
    if len(mine) == len(theirs) and mine != theirs:
        at = next(i for i, (a, b) in enumerate(zip(mine, theirs, strict=False)) if a != b)
        problems.append(f"bytes differ from 0x{at:X}")
    by_field = {r[0]: r for r in target.relocs}
    rel_set = {r.offset for r in candidate.relocs}
    for r in candidate.relocs:
        t = by_field.get(r.offset)
        if t is None:
            problems.append(f"it refers to an address where the original's instruction has none (byte 0x{r.offset:X})")
            continue
        field_type, original = t[1], t[2]
        same_kind = (r.type in _REL[target.arch] and field_type in _REL[target.arch]) or \
                    (r.type in _ABS[target.arch] and field_type in _ABS[target.arch])
        got = candidate.format == "elf" and r.type in _GOT[target.arch]
        base = _resolve(symbols, f"{r.symbol}@got") if got else _resolve(symbols, r.symbol)
        if base is None:
            # A section-relative or local reference: the encoded value is what a linker would keep.
            size = _field_size(target.arch, r.type)
            if _field(candidate.code, r.offset, size) != _field(target.code, r.offset, size):
                problems.append(f"`{r.symbol}` is not a known symbol (byte 0x{r.offset:X})")
            continue
        if not same_kind:
            problems.append(f"`{r.symbol}` is used as a different kind of reference at byte 0x{r.offset:X}")
            continue
        dest = base + r.addend
        if candidate.format == "elf" and r.type in _REL[target.arch]:
            # ELF RELA stores the addend with P subtracted; COFF REL32 is relative to the field's end.
            dest += t[3] - r.offset
        dest &= (1 << (32 if target.arch == "x86" else 64)) - 1  # i386 REL addends are read unsigned (-4 = 0xfffffffc)
        if dest != original:
            got = symbols.label(dest) if dest < 1 << 63 else hex(dest)
            problems.append(f"refers to {got} where the original refers to {symbols.label(original)} (byte 0x{r.offset:X})")
    for field, _, _, _ in target.relocs:
        if field not in rel_set and field < len(candidate.code):
            problems.append(f"the original has a reference at byte 0x{field:X} your code doesn't")
    problems = list(dict.fromkeys(problems))
    return LinkResult(candidate, not problems and len(candidate.code) == len(target.code), problems)
