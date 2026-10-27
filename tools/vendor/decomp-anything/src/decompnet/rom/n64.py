"""N64 ROM images: byte order, header, and a first guess at the compiler.

Only facts read from the user's own file. Nothing here identifies a game against a database.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import asdict, dataclass

import rabbitizer

MAGIC = {
    b"\x80\x37\x12\x40": "z64",  # big-endian, the native byte order
    b"\x37\x80\x40\x12": "v64",  # 16-bit byte-swapped (Doctor V64)
    b"\x40\x12\x37\x80": "n64",  # 32-bit little-endian
}
REGIONS = {
    "A": "All regions", "B": "Brazil", "C": "China", "D": "Germany", "E": "North America", "F": "France",
    "G": "Gateway 64 (NTSC)", "H": "Netherlands", "I": "Italy", "J": "Japan", "K": "Korea", "L": "Gateway 64 (PAL)",
    "N": "Canada", "P": "Europe", "S": "Spain", "U": "Australia", "W": "Scandinavia", "X": "Europe", "Y": "Europe",
}
MIN_SIZE = 0x40000  # 256 KiB: smaller than any cartridge, but leaves room for homebrew
MAX_SIZE = 64 * 1024 * 1024


class RomError(ValueError):
    pass


@dataclass
class RomInfo:
    title: str
    game_code: str
    region: str
    version: int
    entrypoint: int
    crc1: int
    crc2: int
    size: int
    sha1: str
    byte_order: str  # the format the file came in; we always work on z64
    compiler_guess: str  # "IDO" or "KMC"

    def to_dict(self) -> dict:
        return asdict(self)


def to_z64(data: bytes) -> tuple[bytes, str]:
    """Normalize a ROM image to big-endian (z64) and report the byte order it came in."""
    fmt = MAGIC.get(data[:4])
    if fmt is None:
        raise RomError("this doesn't look like an N64 ROM image (.z64, .n64 or .v64)")
    if len(data) % 4:
        raise RomError("ROM size is not a multiple of 4 bytes; the file may be truncated")
    if fmt == "v64":
        b = bytearray(data)
        b[0::2], b[1::2] = data[1::2], data[0::2]
        return bytes(b), fmt
    if fmt == "n64":
        words = struct.unpack(f"<{len(data) // 4}I", data)
        return struct.pack(f">{len(words)}I", *words), fmt
    return data, fmt


def _text(raw: bytes) -> str:
    for enc in ("ascii", "shift_jis"):
        try:
            return raw.decode(enc).rstrip("\0 ").strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1").rstrip("\0 ").strip()


def guess_compiler(rom: bytes, start: int = 0x1000, limit: int = 0x100000) -> str:
    """IDO prefers `b` (beq $zero, $zero) for unconditional jumps inside functions; GCC (KMC) uses `j`.
    The same heuristic splat uses; good enough to pick a default the user can change."""
    jumps = branches = 0
    for (word,) in struct.iter_unpack(">I", rom[start:min(len(rom), start + limit)]):
        insn = rabbitizer.Instruction(word)
        if not insn.isImplemented():
            break
        if insn.uniqueId == rabbitizer.InstrId.cpu_j:
            jumps += 1
        elif insn.uniqueId == rabbitizer.InstrId.cpu_b:
            branches += 1
    return "IDO" if branches > jumps else "KMC"


def read_info(data: bytes) -> tuple[bytes, RomInfo]:
    """(z64 bytes, header info) for a ROM image, or RomError with a message for the user."""
    if len(data) < MIN_SIZE:
        raise RomError(f"file is too small to be an N64 ROM ({len(data)} bytes)")
    if len(data) > MAX_SIZE:
        raise RomError("file is larger than any N64 cartridge (64 MiB)")
    rom, fmt = to_z64(data)
    entry, = struct.unpack(">I", rom[8:12])
    crc1, crc2 = struct.unpack(">II", rom[0x10:0x18])
    code = _text(rom[0x3B:0x3F])
    info = RomInfo(
        title=_text(rom[0x20:0x34]) or "Untitled",
        game_code=code,
        region=REGIONS.get(code[3:4], "Unknown region") if len(code) == 4 else "Unknown region",
        version=rom[0x3F],
        entrypoint=entry,
        crc1=crc1,
        crc2=crc2,
        size=len(rom),
        sha1=hashlib.sha1(rom).hexdigest(),
        byte_order=fmt,
        compiler_guess=guess_compiler(rom),
    )
    if not 0x80000000 <= entry < 0x80800000:
        raise RomError(f"the header's entry point 0x{entry:08X} is not in N64 RAM; is this a real ROM image?")
    return rom, info
