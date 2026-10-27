"""PlayStation 2 programs: the game's main executable is an ELF for the Emotion Engine (e.g. SLUS_200.00 on the disc,
named by SYSTEM.CNF's BOOT2 line). Usually stripped, sometimes still with symbols."""

from __future__ import annotations

import hashlib
import re
import struct

from .n64 import RomError
from .psx import region_of

EM_MIPS = 8


def is_mips_elf(data: bytes) -> bool:
    return len(data) > 0x34 and data[:4] == b"\x7fELF" and data[5] == 1 and struct.unpack_from("<H", data, 18)[0] == EM_MIPS


def read_elf(data: bytes, boot_name: str = "") -> tuple[bytes, dict]:
    if not is_mips_elf(data) or data[4] != 1:
        raise RomError("this isn't a PlayStation 2 program (expected a 32-bit little-endian MIPS ELF)")
    e_type, _, entry = struct.unpack_from("<HHI", data, 16)[0], 0, struct.unpack_from("<I", data, 24)[0]
    if e_type != 2:
        raise RomError("this ELF isn't an executable (it may be a library or an object file)")
    code = ""
    m = re.match(r"^([A-Z]{4})[_-](\d{3})\.?(\d{2})", boot_name.upper())
    if m:
        code = f"{m.group(1)}-{m.group(2)}{m.group(3)}"
    has_symbols = b".symtab" in data[-65536:] or b".symtab" in data[:65536]
    return data, {
        "title": code or boot_name or "PlayStation 2 game", "game_code": code, "region": region_of(code) if code else "Unknown region",
        "version": 0, "entrypoint": entry, "gp": 0, "crc1": 0, "crc2": 0, "size": len(data),
        "sha1": hashlib.sha1(data).hexdigest(), "byte_order": "elf", "compiler_guess": "EEGCC", "platform": "ps2",
        "boot": boot_name, "symbols": has_symbols,
    }
