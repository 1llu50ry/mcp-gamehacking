"""Function starts luvdis didn't reach in a GBA ROM.

Three kinds of evidence, each checked so that real functions aren't cut in two:
- Thumb prologues (`push {..., lr}`) right after a return or padding;
- leaf functions (no prologue) right after a return;
- code that words in the ROM point at with the Thumb bit set (callbacks, function tables).

A candidate is dropped when it's a literal-pool word a known function loads, alignment padding (`nop`), or still
inside the function before it: a branch of that function jumps to it or past it (code after an early return).
"""

from __future__ import annotations

import bisect
import re

import capstone

BASE = 0x08000000


def _md(detail: bool = False) -> capstone.Cs:
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    md.detail = detail
    return md


def plausible_function(rom: bytes, off: int, limit: int = 0x800) -> bool:
    """Valid Thumb code from `off` to a return (`pop {..., pc}` or `bx`), as compilers emit it."""
    md = _md()
    pos, end = off, min(len(rom), off + limit)
    while pos < end:
        ins = next(md.disasm(rom[pos:pos + 4], BASE + pos, 1), None)
        if ins is None:
            return False
        if (ins.mnemonic == "pop" and "pc" in ins.op_str) or ins.mnemonic == "bx":
            return True
        pos += ins.size
    return False


def _is_return(ins) -> bool:
    return (ins.mnemonic == "pop" and "pc" in ins.op_str) or ins.mnemonic == "bx"


def _target(ins) -> int | None:
    if ins.mnemonic.startswith("b") and ins.mnemonic not in ("bl", "blx", "bx", "bic", "bics"):
        m = re.match(r"#(0x[0-9a-f]+)", ins.op_str)
        if m:
            return int(m.group(1), 16)
    return None


def bodies(rom: bytes, known: list[int], literals: set[int] | None = None):
    """(start offset, end offset, instructions) of each known function: it ends at the first return that none of its
    own earlier branches jumps past (later code with a gap is another function or data). Literal pools in the
    middle of a function (after an unconditional branch) are stepped over."""
    md = _md()
    literals = literal_words(rom, known) if literals is None else literals
    starts = sorted({(a & ~1) - BASE for a in known})
    for k, start in enumerate(starts):
        limit = min(len(rom), starts[k + 1] if k + 1 < len(starts) else start + 0x2000)
        body, furthest, pos = [], start, start
        while pos < limit:
            if pos in literals:
                pos += 2
                continue
            ins = next(md.disasm(rom[pos:pos + 4], BASE + pos, 1), None)
            if ins is None:
                break
            body.append(ins)
            pos += ins.size
            t = _target(ins)
            if t is not None:
                furthest = max(furthest, t - BASE)
            if _is_return(ins) and furthest <= ins.address - BASE:
                break
        end = (body[-1].address + body[-1].size - BASE) if body else start
        yield start, max(end, furthest), body


def literal_words(rom: bytes, known: list[int]) -> set[int]:
    """ROM offsets of literal-pool words: every `ldr rX, [pc, #imm]` target in a linear Thumb sweep of the whole ROM
    (also through functions nobody found yet). Junk decoded from data only adds entries, which is the safe side."""
    md = _md()
    md.skipdata = True
    out = set()
    for ins in md.disasm(rom[0xC0:], BASE + 0xC0):
        if ins.mnemonic.startswith("ldr") and "[pc" in ins.op_str:
            m = re.search(r"#(0x[0-9a-f]+|\d+)", ins.op_str)
            at = ((ins.address + 4) & ~3) + (int(m.group(1), 0) if m else 0) - BASE
            out.update((at, at + 2))
    return out


def branch_reach(rom: bytes, known: list[int], literals: set[int] | None = None) -> dict[int, int]:
    """Known function start -> end of its own code (see _bodies)."""
    return {start: end for start, end, _ in bodies(rom, known, literals)}


def candidates(rom: bytes, known: list[int]) -> list[int]:
    known_set = {a & ~1 for a in known}
    literals = literal_words(rom, known)
    reach = branch_reach(rom, known, literals)
    starts = sorted(reach)

    def inside_known(off: int) -> bool:
        k = bisect.bisect_right(starts, off) - 1
        return k >= 0 and reach[starts[k]] > off

    out = set()
    for off in range(0xC0, len(rom) - 2, 2):
        if BASE + off in known_set or off in literals or inside_known(off):
            continue
        half = rom[off] | rom[off + 1] << 8
        if half in (0, 0x46C0):  # padding or nop
            continue
        prev = rom[off - 2] | rom[off - 1] << 8
        after_return = (prev & 0xFF87) == 0x4700 or (prev & 0xFF00) == 0xBD00
        after_padding = prev in (0, 0x46C0) and off >= 4 and (
            ((rom[off - 4] | rom[off - 3] << 8) & 0xFF87) == 0x4700 or (rom[off - 3] == 0xBD))
        prologue = (half & 0xFF00) == 0xB500
        if ((prologue and (after_return or after_padding or prev == 0)) or after_return or after_padding) \
                and plausible_function(rom, off):
            out.add(BASE + off)
    for _, _, body in bodies(rom, known, literals):  # whatever known code calls is a function
        for ins in body:
            if ins.mnemonic == "bl":
                m = re.match(r"#(0x[0-9a-f]+)", ins.op_str)
                target = int(m.group(1), 16) - BASE if m else -1
                if 0xC0 <= target < len(rom) and BASE + target not in known_set and target not in literals \
                        and plausible_function(rom, target):
                    out.add(BASE + target)
    for off in range(0, len(rom) - 4, 4):  # pointers to Thumb code (low bit set)
        word = int.from_bytes(rom[off:off + 4], "little")
        target = (word & ~1) - BASE
        if word & 1 and 0xC0 <= target < len(rom) and BASE + target not in known_set and target not in literals \
                and not inside_known(target) and plausible_function(rom, target):
            out.add(BASE + target)
    return sorted(out)
