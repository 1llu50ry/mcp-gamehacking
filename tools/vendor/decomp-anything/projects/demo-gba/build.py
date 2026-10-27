"""Build Demo Quest GBA, a Game Boy Advance ROM made only from code we may share: the same Demo Quest game, main loop
and tiny libc as the N64 demo (CC0, ../demo-rom/src, ../demo-n64/original) and zlib 1.1.4 (Zlib license), compiled
the way GBA games were: the C preprocessor, agbcc (pret's rebuild of the GBA's GCC) at -O2 -mthumb-interwork, and the
GNU assembler, as in pret's projects.

    uv run python projects/demo-gba/build.py    ->  build/demoquest.gba (+ build/demoq_gba.elf with symbols)
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from decompnet import toolchains

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
DEMO = HERE.parent / "demo-rom" / "src"
GAME = HERE.parent / "demo-n64" / "original"
ZLIB = HERE.parent / "zlib-n64"
ZLIB_UNITS = ["adler32", "compress", "crc32", "deflate", "inflate", "infblock", "infcodes", "inffast", "inftrees",
              "infutil", "trees", "uncompr", "zutil"]


def run(argv, cwd=BUILD):
    res = subprocess.run([str(a) for a in argv], capture_output=True, text=True, cwd=cwd)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, argv))}\n{res.stdout}{res.stderr}")


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir()
    agbcc = toolchains.ensure("agbcc", log=print)
    arm = toolchains.ensure("arm-gnu", log=print) / "bin"
    jobs = [(HERE / "gbart.c", []), (DEMO / "main.c", [GAME]), (DEMO / "libc.c", []), (GAME / "game.c", [GAME])]
    jobs += [(ZLIB / "original" / f"{u}.c", [ZLIB / "sysinclude", ZLIB / "original"]) for u in ZLIB_UNITS]
    objs = []
    for src, incs in jobs:
        stem = src.stem
        run([arm / "arm-none-eabi-cpp", "-nostdinc", "-undef", "-I", agbcc / "include",
             *[a for i in incs for a in ("-I", i)], src, "-o", f"{stem}.i"])
        run([agbcc / "bin" / "agbcc", "-mthumb-interwork", "-O2", "-fhex-asm", f"{stem}.i", "-o", f"{stem}.s"])
        run([arm / "arm-none-eabi-as", "-mcpu=arm7tdmi", "-o", f"{stem}.o", f"{stem}.s"])
        objs.append(f"{stem}.o")
    shutil.copy(HERE / "crt0.s", BUILD / "crt0.s")
    run([arm / "arm-none-eabi-as", "-mcpu=arm7tdmi", "-o", "crt0.o", "crt0.s"])
    run([arm / "arm-none-eabi-ld", "-T", HERE / "rom.ld", "-o", "demoq_gba.elf", "crt0.o", *objs])
    run([arm / "arm-none-eabi-objcopy", "-O", "binary", "demoq_gba.elf", "demoquest.gba"])
    rom = bytearray((BUILD / "demoquest.gba").read_bytes())
    rom[0xBD] = (-(sum(rom[0xA0:0xBD]) + 0x19)) & 0xFF  # header checksum
    (BUILD / "demoquest.gba").write_bytes(bytes(rom))
    print(f"built build/demoquest.gba ({len(rom)} bytes)")


if __name__ == "__main__":
    main()
