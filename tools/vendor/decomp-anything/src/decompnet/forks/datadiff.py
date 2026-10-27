"""A file's data next to the original's: what still keeps it from being linked once its functions match.

A file links when its whole object is the original's: every function, and every data section (constants the
compiler pools, strings, tables, globals) with the same values in the same order. The compiler emits most of it from
the functions (their literals, in the order the functions use them), so once every function matches, what's left is
the data written by hand: globals and statics in the right section and order, with the original's values.
Both objects are read directly; values are shown decoded (float, double, string) and compared in order. Words a
relocation fills in (pointers) are compared by what they point at being data of the same kind, not by address.
"""

from __future__ import annotations

import difflib
import struct
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection

_SKIP = (".comment", ".note", ".debug", ".line", ".mwcats", ".gnu", ".reginfo", ".mdebug", ".pdr", ".MIPS")


@dataclass
class Item:
    name: str
    data: bytes | None  # None: .bss (only a size)
    size: int
    pointers: tuple[int, ...] = ()  # offsets of relocated words in it

    def key(self) -> tuple:
        if self.data is None:
            return ("bss", self.size)
        data = bytearray(self.data)
        for at in self.pointers:
            data[at:at + 4] = b"PTR!"
        return (bytes(data),)


@dataclass
class Section:
    name: str
    original: list[Item]
    yours: list[Item] | None  # None: your object has no such section
    rows: list[tuple[str, Item | None, Item | None]] = field(default_factory=list)  # (mark, original, yours)

    @property
    def matches(self) -> bool:
        return self.yours is not None and all(m == " " for m, _, _ in self.rows)


def _items(path: Path) -> dict[str, list[Item]]:
    elf = ELFFile(BytesIO(path.read_bytes()))
    out: dict[str, list[Item]] = {}
    symtab = elf.get_section_by_name(".symtab")
    relocs: dict[int, list[int]] = {}
    for rs in elf.iter_sections():
        if isinstance(rs, RelocationSection):
            relocs.setdefault(rs["sh_info"], []).extend(r["r_offset"] for r in rs.iter_relocations())
    for idx, sec in enumerate(elf.iter_sections()):
        flags = sec["sh_flags"]
        if not sec.name or sec.name.startswith(_SKIP) or not flags & 0x2 or flags & 0x4:  # allocated, not code
            continue
        if sec["sh_type"] not in ("SHT_PROGBITS", "SHT_NOBITS") or not sec["sh_size"]:
            continue
        nobits = sec["sh_type"] == "SHT_NOBITS"
        data = b"" if nobits else sec.data()
        syms = sorted({s["st_value"]: s for s in (symtab.iter_symbols() if symtab else [])
                       if s["st_shndx"] == idx and s["st_info"]["type"] not in ("STT_SECTION", "STT_FILE")
                       and s.name and not s.name.startswith("$")}.items())
        starts = [v for v, _ in syms]
        if not starts or starts[0] != 0:
            starts = [0, *starts]
            syms = [(0, None), *syms]
        items = []
        for k, (value, s) in enumerate(syms):
            end = starts[k + 1] if k + 1 < len(starts) else sec["sh_size"]
            size = (s["st_size"] if s is not None and s["st_size"] else end - value)
            size = max(0, min(size, sec["sh_size"] - value))
            if not size:
                continue
            name = s.name if s is not None else f"{sec.name}+0x{value:X}"
            ptrs = tuple(r - value for r in relocs.get(idx, []) if value <= r < value + size)
            items.append(Item(name, None if nobits else data[value:value + size], size, ptrs))
            if not nobits and end > value + size and any(data[value + size:end]):  # bytes no symbol covers
                items.append(Item(f"{sec.name}+0x{value + size:X}", data[value + size:end], end - value - size))
        out.setdefault(sec.name, []).extend(items)
    return out


def _padding(item: Item) -> bool:
    """Alignment the original's split names (gap_...) or zero bytes between data: not something to write."""
    return item.data is not None and not any(item.data) and (item.name.startswith("gap_") or "+0x" in item.name)


def compare(target: Path, base: Path | None) -> list[Section]:
    """Every data section of the original's object, in order, next to yours."""
    theirs = _items(target)
    mine = _items(base) if base is not None and base.exists() else {}
    out = []
    for name, original in theirs.items():
        yours = mine.get(name)
        a = [i for i in original if not _padding(i)]
        b = [i for i in (yours or []) if not _padding(i)]
        rows: list[tuple[str, Item | None, Item | None]] = []
        sm = difflib.SequenceMatcher(a=[i.key() for i in a], b=[i.key() for i in b], autojunk=False)
        for op, a0, a1, b0, b1 in sm.get_opcodes():
            if op == "equal":
                rows += [(" ", x, y) for x, y in zip(a[a0:a1], b[b0:b1], strict=False)]
                continue
            for k in range(max(a1 - a0, b1 - b0)):
                x = a[a0 + k] if a0 + k < a1 else None
                y = b[b0 + k] if b0 + k < b1 else None
                rows.append(("|" if x and y else "<" if x else ">", x, y))
        out.append(Section(name, original, yours, rows))
    for name, yours in mine.items():  # sections only yours has
        if name not in theirs and any(not _padding(i) for i in yours):
            rows = [(">", None, y) for y in yours if not _padding(y)]
            out.append(Section(name, [], yours, rows))
    return out


def show(item: Item | None) -> str:
    if item is None:
        return ""
    if item.data is None:
        return f"{item.name}: {item.size} bytes of zeros (.bss)"
    d = item.data
    if item.pointers and len(d) == 4 * len(item.pointers):
        value = f"{len(item.pointers)} pointer{'s' if len(item.pointers) > 1 else ''}"
    elif len(d) == 4 and not item.pointers:
        f = struct.unpack(">f", d)[0]
        value = f"{f!r}f" if d != b"\0\0\0\0" and 1e-6 < abs(f) < 1e9 else f"0x{d.hex().upper()}"
    elif len(d) == 8 and not item.pointers:
        f = struct.unpack(">d", d)[0]
        value = f"{f!r}" if 1e-9 < abs(f) < 1e15 else f"0x{d.hex().upper()}"
    elif d.rstrip(b"\0") and all(32 <= c < 127 or c in (9, 10, 13) or c >= 0x80 for c in d.rstrip(b"\0")):
        text = d.rstrip(b"\0").decode("latin-1").replace("\n", "\\n")
        value = '"' + (text if len(text) <= 40 else text[:40] + "…") + '"'
    else:
        value = d[:16].hex(" ") + ("…" if len(d) > 16 else "") + (f" ({len(item.pointers)} pointers)" if item.pointers else "")
    return f"{item.name} = {value}" if len(f"{item.name} = {value}") < 60 else f"{item.name[:30]}… = {value}"


def hints(sections: list[Section]) -> list[str]:
    """What the differences usually mean, said plainly."""
    out = []
    where = {i.name.split("$")[0]: s.name for s in sections for i in s.original}
    for sec in sections:
        for i in sec.yours or []:
            orig = where.get(i.name)
            if orig and orig != sec.name:
                fix = "const" if orig.startswith((".rodata", ".sdata2", ".rdata")) else f"not const ({orig})"
                out.append(f"{i.name} is in {sec.name} in yours but {orig} in the original: declare it {fix}")
        theirs = {i.name for i in sec.original}
        for i in sec.original:
            base, _, n = i.name.partition("$")
            if n.isdigit() and base in {y.name for y in sec.yours or []} and base not in theirs:
                out.append(f"the original's {base} is a static variable inside a function ({i.name}): move it into "
                           "the function that uses it")
    return list(dict.fromkeys(out))


def render(sections: list[Section], max_rows: int = 60) -> str:
    """The sections that differ: the original's data next to yours, in order."""
    lines = [f"hint: {h}" for h in hints(sections)]
    for sec in sections:
        if sec.matches:
            continue
        if sec.yours is None:
            lines.append(f"{sec.name}: yours has none of it yet ({len(sec.original)} items in the original)")
        else:
            lines.append(f"{sec.name}: differs (< the original's, missing from yours; > only yours; | different)")
        width = 44
        shown = 0
        for i, (mark, x, y) in enumerate(sec.rows):
            near = any(m != " " for m, _, _ in sec.rows[max(0, i - 1):i + 2])
            if not near:
                continue
            lines.append(f" {mark} {show(x)[:width]:<{width}} | {show(y)}")
            shown += 1
            if shown >= max_rows:
                lines.append("   ...")
                break
    return "\n".join(lines)
