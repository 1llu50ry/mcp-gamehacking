"""Build Demo Quest 64, a small but real N64 ROM image made only from code we may share:
the Demo Quest game (CC0, ../demo-n64/original), a tiny libc and main loop (CC0, src/), and
zlib 1.1.4 (Zlib license, ../zlib-n64/original; run ../zlib-n64/prepare.py first).

Everything is compiled with the pinned KMC-compatible GCC 2.7.2, exactly like a period N64 game,
and linked to run from 0x80000400. The boot code area (IPL3) is left empty: this ROM exists to be
decompiled, not played, and the real IPL3 is Nintendo's code.

    uv run python projects/demo-rom/build.py      ->  build/demo-quest-64.z64 (+ .elf with symbols)
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import sys
from pathlib import Path

from decompnet import toolchains

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
ZLIB = HERE.parent / "zlib-n64"
GAME = HERE.parent / "demo-n64" / "original"
ZLIB_UNITS = ["adler32", "compress", "crc32", "deflate", "infblock", "infcodes", "inffast", "inflate",
              "inftrees", "infutil", "trees", "uncompr", "zutil"]
ROM_SIZE = 0x200000  # 2 MiB, so the boot checksum range (1 MiB after the boot area) is all there
NAME = "DEMO QUEST 64"
GAME_CODE = b"NDQE"  # N = cartridge, DQ = Demo Quest, E = North America
ENTRY = 0x80000400


def run(argv: list[str]) -> None:
    res = subprocess.run(argv, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(argv)}\n{res.stdout}{res.stderr}")


def compile_all() -> list[Path]:
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    cc = [a.replace("{tc}", tc_dir) for a in tc.cc]
    BUILD.mkdir(exist_ok=True)
    objs = []
    jobs = [(HERE / "src" / "entry.s", [])]
    jobs += [(HERE / "src" / "main.c", [f"-I{GAME}"]), (HERE / "src" / "libc.c", [])]
    jobs += [(GAME / "game.c", [f"-I{GAME}"])]
    jobs += [(ZLIB / "original" / f"{u}.c", [f"-I{ZLIB / 'sysinclude'}", f"-I{ZLIB / 'original'}"]) for u in ZLIB_UNITS]
    for src, extra in jobs:
        if not src.exists():
            sys.exit(f"missing {src} (for zlib, run projects/zlib-n64/prepare.py first)")
        obj = BUILD / f"{src.stem}.o"
        run([*cc, *tc.flags, *extra, str(src), "-o", str(obj)])
        objs.append(obj)
    return objs


def n64_crc(rom: bytes) -> tuple[int, int]:
    """CIC-6102 checksum over the first MiB after the boot area (the value in the header at 0x10)."""
    m = 0xFFFFFFFF
    t1 = t2 = t3 = t4 = t5 = t6 = 0xF8CA4DDC
    for (d,) in struct.iter_unpack(">I", rom[0x1000:0x101000]):
        if (t6 + d) & m < t6:
            t4 = (t4 + 1) & m
        t6 = (t6 + d) & m
        t3 ^= d
        r = ((d << (d & 0x1F)) | (d >> (32 - (d & 0x1F)))) & m if d & 0x1F else d
        t5 = (t5 + r) & m
        t2 = t2 ^ r if t2 > d else t2 ^ t6 ^ d
        t1 = (t1 + (t5 ^ d)) & m
    return t6 ^ t4 ^ t3, t5 ^ t2 ^ t1


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    objs = compile_all()
    elf = BUILD / "demo-quest-64.elf"
    run(["ld.lld", "-m", "elf32btsmip", "-T", str(HERE / "rom.ld"), "--no-check-sections", "-o", str(elf),
         *[str(o) for o in objs]])
    code = BUILD / "code.bin"
    run(["llvm-objcopy", "-O", "binary", "--only-section=.text", "--only-section=.rodata", "--only-section=.data",
         str(elf), str(code)])
    body = code.read_bytes()
    if 0x1000 + len(body) > ROM_SIZE:
        sys.exit("code does not fit in the ROM")
    rom = bytearray(ROM_SIZE)
    rom[0x1000:0x1000 + len(body)] = body
    header = struct.pack(">IIII", 0x80371240, 0x0000000F, ENTRY, 0x00001449)
    header += b"\0" * 16 + NAME.encode().ljust(20, b" ") + b"\0" * 7 + GAME_CODE + b"\0"
    assert len(header) == 0x40
    rom[0:0x40] = header
    crc1, crc2 = n64_crc(bytes(rom))
    rom[0x10:0x18] = struct.pack(">II", crc1, crc2)
    out = BUILD / "demo-quest-64.z64"
    out.write_bytes(rom)
    code.unlink()
    print(f"built {out.relative_to(HERE)}: {len(body)} bytes of code+data, CRC {crc1:08X} {crc2:08X}")


if __name__ == "__main__":
    main()
