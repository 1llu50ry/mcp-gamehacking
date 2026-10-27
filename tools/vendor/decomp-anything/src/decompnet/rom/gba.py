"""Game Boy Advance ROMs: header, and finding the functions.

Functions are found by luvdis (MIT), which follows the code from the entry point and guesses functions called from
known code. Code nothing calls (or reaches only through pointers) is found by a second pass: Thumb prologues
(`push {..., lr}`) in what's still unclaimed bytes are handed back to luvdis as function starts, until nothing new
turns up.
"""

from __future__ import annotations

import hashlib
import re
import struct
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from .. import toolchains
from ..limits import capped
from . import gba_candidates
from .n64 import RomError

BASE = 0x08000000


def is_gba(data: bytes) -> bool:
    if len(data) < 0xC0 or data[0xB2] != 0x96:
        return False
    if (struct.unpack_from("<I", data, 0)[0] & 0xFF000000) != 0xEA000000:  # ARM `b` to the start-up code
        return False
    return (-(sum(data[0xA0:0xBD]) + 0x19)) & 0xFF == data[0xBD]


def read_info(data: bytes) -> dict:
    if not is_gba(data):
        raise RomError("this isn't a Game Boy Advance ROM")
    title = data[0xA0:0xAC].split(b"\0", 1)[0].decode("ascii", "replace").strip()
    code = data[0xAC:0xB0].decode("ascii", "replace")
    region = {"E": "North America", "J": "Japan", "P": "Europe", "D": "Germany", "F": "France", "I": "Italy",
              "S": "Spain"}.get(code[3:4], "Unknown region")
    return {"title": title or code, "game_code": code, "region": region, "version": data[0xBC], "size": len(data),
            "sha1": hashlib.sha1(data).hexdigest(), "entrypoint": BASE, "platform": "gba", "byte_order": "gba",
            "compiler_guess": "AGBCC", "gp": 0}


def _luvdis(rom: Path, workdir: Path, cfg_in: Path | None) -> tuple[str, list[int]]:
    python = toolchains.venv_bin(toolchains.ensure("luvdis", log=lambda *_: None) / "venv", "python")
    out, cfg = workdir / "rom.s", workdir / "functions.cfg"
    args = [str(python), "-I", str(Path(__file__).with_name("luvdis_run.py")), "disasm", str(rom), "--min-calls", "1",
            "--min-length", "2", "-o", str(out), "-co", str(cfg)]
    if cfg_in is not None:
        args[5:5] = ["-c", str(cfg_in)]
    try:
        res = subprocess.run(capped(args), capture_output=True, text=True, timeout=3600, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        raise RomError("luvdis (the GBA disassembler) took more than an hour on this ROM and was stopped. Please "
                       "report it with the log: the game's size and title help") from None
    if res.returncode != 0 or not out.exists():
        raise RomError("luvdis couldn't disassemble the ROM: " + (res.stderr or res.stdout)[-400:])
    found = sorted({int(m.group(1), 16) for m in re.finditer(r"^(?:[a-z_]+[ \t]+)?(0x[0-9A-Fa-f]+)",
                                                             cfg.read_text(encoding="utf-8"), re.MULTILINE)})
    return out.read_text(encoding="utf-8"), found


def find_functions(rom_path: Path, workdir: Path, rounds: int = 4, log=lambda *_: None,
                   budget: float = 1800) -> tuple[str, list[int]]:
    """(assembly, function addresses) for the ROM, with prologue hunting in what luvdis left as data. The extra
    rounds stop once `budget` seconds have gone by (a 32 MiB ROM takes minutes a round)."""
    rom = rom_path.read_bytes()
    t0 = time.time()
    asm, found = _luvdis(rom_path, workdir, None)
    log(f"luvdis followed the code from the start: {len(found)} functions ({time.time() - t0:.0f}s)")
    for k in range(rounds):
        if time.time() - t0 > budget:
            log("stopping the search for more here: it has run half an hour (agents can split what's left)")
            break
        extra = [a for a in gba_candidates.candidates(rom, found) if a not in found]
        if not extra:
            break
        log(f"round {k + 2}: {len(extra)} more function starts in code nothing calls directly")
        cfg = workdir / "candidates.cfg"
        cfg.write_text("".join(f"thumb_func 0x{a:X}\n" for a in sorted(set(found) | set(extra))), encoding="utf-8")
        asm, found2 = _luvdis(rom_path, workdir, cfg)
        if set(found2) == set(found):
            break
        found = found2
    return asm, found


def call_via(code: bytes) -> str | None:
    """libgcc's `_call_via_rN` thunks (`bx rN` and a nop): hand-written assembly no C compiles to."""
    if len(code) in (2, 4) and code[1] == 0x47 and code[0] & 0x87 == 0 and code[2:] in (b"", b"\xc0\x46", b"\0\0"):
        reg = (code[0] >> 3) & 0xF
        if reg < 13:  # `bx lr` alone is also an empty C function
            return f"_call_via_r{reg}"
    return None


@dataclass
class GbaFunction:
    name: str
    vram: int
    rom: int
    code: bytes
    asm: str
    n_insns: int
    thumb: bool = True
    refs: list[tuple[int, int, int]] | None = None  # (offset, kind, address): 10 = call, 2 = data pointer
    asm_only: str | None = None  # the name of a known hand-written assembly helper


def _asm_blocks(asm: str) -> dict[int, tuple[str, bool]]:
    """address -> (luvdis's assembly for that function, is Thumb)."""
    out: dict[int, tuple[str, bool]] = {}
    current, lines, thumb = None, [], True
    for line in asm.splitlines():
        m = re.match(r"\s*(thumb|arm|non_word_aligned_thumb)_func_start\s+\w*?([0-9A-F]{7,8})\b", line)
        if m:
            if current is not None:
                out[current] = ("\n".join(lines).rstrip() + "\n", thumb)
            current, lines, thumb = int(m.group(2), 16), [line], m.group(1) != "arm"
        elif current is not None:
            lines.append(line)
    if current is not None:
        out[current] = ("\n".join(lines).rstrip() + "\n", thumb)
    return out


def _refs(code: bytes, addr: int, literals: set[int], off: int) -> list[tuple[int, int, int]]:
    """Calls (Thumb `bl`) and data pointers (literal-pool words holding RAM/ROM addresses) in a function."""
    from .match_arm import thumb_bl_dest

    out = []
    at = 0
    while at + 4 <= len(code):
        if off + at in literals and at % 4 == 0:
            value = int.from_bytes(code[at:at + 4], "little")
            if 0x02000000 <= value < 0x0A000000:
                out.append((at, 2, value & ~1 if value & 1 and value >= BASE else value))
            at += 4
            continue
        dest = thumb_bl_dest(code, at, addr + at)
        if dest is not None:
            out.append((at, 10, dest & ~1))
            at += 4
            continue
        at += 2
    return out


def split(rom_path: Path, workdir: Path, log=print) -> list[GbaFunction]:
    """Every function in the ROM: its bytes (code and the literal pool it loads), assembly and size."""
    rom = rom_path.read_bytes()
    big = len(rom) > 8 << 20
    log("finding the functions (luvdis, then a pass for code nothing calls)"
        + (f": a {len(rom) >> 20} MiB ROM takes several minutes" if big else ""))
    asm, found = find_functions(rom_path, workdir, log=log)
    blocks = _asm_blocks(asm)
    starts = sorted({a & ~1 for a in found if BASE <= (a & ~1) < BASE + len(rom)})
    literals = gba_candidates.literal_words(rom, starts)
    ends = {start + BASE: end for start, end, _ in gba_candidates.bodies(rom, starts, literals)}
    out = []
    for k, addr in enumerate(starts):
        off = addr - BASE
        limit = (starts[k + 1] - BASE) if k + 1 < len(starts) else len(rom)
        end = min(ends.get(addr, limit), limit)
        while end + 4 <= limit and (end in literals or (end % 4 == 2 and end + 2 in literals and
                                                       rom[end:end + 2] in (b"\0\0", b"\xc0\x46"))):
            end += 2 if end % 4 == 2 and end not in literals else 4  # the literal pool after the code
        text, thumb = blocks.get(addr, (f"\tthumb_func_start sub_{addr:08X}\n", True))
        code = rom[off:end]
        out.append(GbaFunction(f"sub_{addr:08X}", addr, off, code, text, max(1, len(code) // 2), thumb,
                               _refs(code, addr, literals, off), call_via(code)))
    log(f"found {len(out)} functions")
    return out
