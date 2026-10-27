"""COFF object parsing: pull a single function's bytes + relocations out of a Windows .obj file.

Windows compilers (MSVC, clang-cl, MinGW) emit COFF, not ELF. The matcher only needs the same
things elfobj gives it for everything else: one function's code and the fields its relocations
patch. COFF has no symbol sizes, so a function's extent is the next function symbol in its
section, or its whole section when the compiler put it in one (``-ffunction-sections``).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

import capstone

from .elfobj import FunctionObj, Reloc

IMAGE_FILE_MACHINE_I386 = 0x014C
IMAGE_FILE_MACHINE_AMD64 = 0x8664
IMAGE_FILE_MACHINE_ARMNT = 0x01C4
IMAGE_FILE_MACHINE_ARM64 = 0xAA64

_MACHINES = {IMAGE_FILE_MACHINE_I386: "x86", IMAGE_FILE_MACHINE_AMD64: "x86_64"}

IMAGE_SCN_CNT_CODE = 0x00000020
IMAGE_SCN_MEM_EXECUTE = 0x20000000
IMAGE_SYM_CLASS_EXTERNAL = 2
IMAGE_SYM_CLASS_STATIC = 3

# IMAGE_REL_AMD64_REL32 and its four variants
_AMD64_REL = range(4, 10)
# IMAGE_REL_I386_DIR32 / REL32
_I386_ABS = (6, 7, 11)
_I386_REL = (2, 20)

# Padding a compiler puts between functions. It is not code and the target's function ends before it.
# Never include 0x00: it is a legitimate operand byte (a RIP displacement often ends in 00).
_PAD = (0x90, 0xCC, 0x00)


@dataclass
class _Symbol:
    name: str
    value: int
    section: int  # 1-based; 0 undefined, -1 absolute, -2 debug
    type: int
    storage: int
    index: int = 0  # raw symbol-table index (relocations refer to this, aux records included)


@dataclass
class _Reloc:
    offset: int  # within the section
    symbol: int  # symbol table index
    type: int


@dataclass
class _Section:
    name: str
    data: bytes
    characteristics: int
    relocs: list[_Reloc] = field(default_factory=list)

    @property
    def code(self) -> bool:
        return bool(self.characteristics & (IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE))


def is_coff(data: bytes) -> bool:
    if len(data) < 20:
        return False
    machine, nsections = struct.unpack_from("<HH", data, 0)
    opt_size = struct.unpack_from("<H", data, 16)[0]
    if machine not in _MACHINES or not 0 < nsections < 96:
        return False
    # MinGW objects start with a section table (after the optional header, which is normally absent);
    # PE images carry MZ and are parsed elsewhere.
    return data[:2] != b"MZ" and 20 + opt_size + nsections * 40 <= len(data)


def _cstr(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("utf-8", "replace")


def _string(data: bytes, offset: int) -> str:
    return _cstr(data[offset:offset + 256]) if 0 < offset < len(data) else ""


def _symbols(data: bytes, ptr: int, count: int) -> list[_Symbol]:
    out: list[_Symbol] = []
    strings = ptr + 18 * count  # the string table follows the symbol records
    index, at = 0, ptr
    while index < count and at + 18 <= len(data):
        raw, value, section, typ, storage, naux = struct.unpack_from("<8sIhHBB", data, at)
        name = _string(data, strings + struct.unpack_from("<I", raw, 4)[0]) if raw[:4] == b"\x00\x00\x00\x00" else _cstr(raw)
        out.append(_Symbol(name, value, section, typ, storage, index))
        index += 1 + naux
        at += 18 * (1 + naux)
    return out


def _read(data: bytes) -> tuple[str, list[_Section], list[_Symbol]]:
    machine, nsections, _time, symptr, nsyms, opt_size, _chars = struct.unpack_from("<HHIIIHH", data, 0)
    arch = _MACHINES[machine]
    sections: list[_Section] = []
    strings = symptr + 18 * nsyms if symptr else 0
    at = 20 + opt_size
    for _ in range(nsections):
        raw, _vsize, _vaddr, rawsize, rawptr, relptr, _nline, nreloc, _nlno, chars = struct.unpack_from(
            "<8sIIIIIIHHI", data, at)
        name = _cstr(raw)
        if name.startswith("/") and name[1:].isdigit():  # long section name: offset into the string table
            name = _string(data, strings + int(name[1:]))
        body = data[rawptr:rawptr + rawsize] if rawptr and rawsize else b""
        relocs = []
        if relptr and nreloc:
            for k in range(nreloc):
                off, symidx, rtype = struct.unpack_from("<IIH", data, relptr + 10 * k)
                relocs.append(_Reloc(off, symidx, rtype))
        sections.append(_Section(name, body, chars, relocs))
        at += 40
    return arch, sections, _symbols(data, symptr, nsyms) if symptr and nsyms else []


def _key(name: str) -> str:
    """A compiler's decoration of a C name (`_add` i386 cdecl, `_add@8` stdcall) is not part of the name."""
    return name.lstrip("_").split("@", 1)[0].lower()


def _is_function(symbol: _Symbol) -> bool:
    return symbol.section > 0 and (symbol.type & 0x20 or symbol.type == 0x20)  # IMAGE_SYM_DTYPE_FUNCTION


def _defined_in(symbols: list[_Symbol], section: int) -> list[_Symbol]:
    return [s for s in symbols if s.section == section and s.name and not s.name.startswith(".")
            and not (s.storage == IMAGE_SYM_CLASS_STATIC and s.type == 0) and s.name not in (".text", ".data", ".bss")]


def _symbol_name(symbols: list[_Symbol], index: int, sections: list[_Section]) -> str:
    sym = next((s for s in symbols if s.index == index), None)
    if sym is None:
        return f"sym_{index}"
    if sym.section > 0 and sym.name.startswith((".text", ".data", ".rdata", ".bss")):
        # A section symbol. With -ffunction-sections / -fdata-sections the section holds exactly the
        # object it is named after, so the object's own symbol in that section is its real name.
        named = _defined_in(symbols, sym.section)
        if len(named) == 1:
            return named[0].name
        if "$" in sym.name:
            return sym.name.split("$", 1)[1]
    return sym.name


def trim_code(code: bytes, arch: str) -> bytes:
    """Bytes of a function without the alignment padding after its last instruction.

    Decoding rather than looking at the tail matters: a displacement can end in 0x00, and a nop can be
    part of the code. Cut after a terminator only when everything after it is padding."""
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64 if arch == "x86_64" else capstone.CS_MODE_32)
    for ins in md.disasm(code, 0):
        # From here on there is nothing but alignment/padding bytes: the function ended before them.
        # Checking the whole suffix, not just the bytes right after a terminator, keeps an early `ret`
        # whose following block is reachable by a jump.
        if ins.address and all(b in _PAD for b in code[ins.address:]):
            return code[:ins.address]
    return code


def _extent(symbols: list[_Symbol], sym: _Symbol, section: _Section) -> int:
    starts = sorted({s.value for s in symbols if s.section == sym.section and _is_function(s) and s.value > sym.value})
    end = starts[0] if starts else len(section.data)
    return max(0, end - sym.value)


def _find(symbols: list[_Symbol], name: str) -> _Symbol | None:
    functions = [s for s in symbols if _is_function(s)]
    exact = next((s for s in functions if s.name == name), None)
    if exact is not None:
        return exact
    key = _key(name)
    return next((s for s in functions if _key(s.name) == key), None)


def list_functions(data: bytes) -> list[str]:
    if not is_coff(data):
        return []
    _arch, _sections, symbols = _read(data)
    return [s.name for s in symbols if _is_function(s)]


def extract_function(data: bytes, name: str) -> FunctionObj | None:
    """The compiled code for `name` (a C name; stdcall/underscore decoration accepted) and its relocations."""
    if not is_coff(data):
        return None
    arch, sections, symbols = _read(data)
    sym = _find(symbols, name)
    if sym is None or not 0 < sym.section <= len(sections):
        return None
    section = sections[sym.section - 1]
    size = _extent(symbols, sym, section)
    full = section.data[sym.value:sym.value + size]
    code = bytearray(trim_code(full, arch))
    if not code:
        return None
    relocs: list[Reloc] = []
    for r in section.relocs:
        at = r.offset - sym.value
        if not 0 <= at < len(code):
            continue
        relocs.append(Reloc(at, r.type, _symbol_name(symbols, r.symbol, sections), 0))
    relocs.sort(key=lambda r: r.offset)
    return FunctionObj(name=name, arch=arch, big_endian=False, code=bytes(code), relocs=relocs, format="coff")
