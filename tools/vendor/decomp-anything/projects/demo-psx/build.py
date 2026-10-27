"""Build Demo Quest PS1, a PlayStation executable (PS-X EXE) made only from code we may share: the same
Demo Quest game, main loop and tiny libc as the N64 demo (CC0, ../demo-rom/src, ../demo-n64/original) and zlib 1.1.4
(Zlib license), compiled with GCC 2.7.2 for the PlayStation (decompals/old-gcc) at -O2 -G8, the way PSY-Q-era games
put small globals in $gp-relative data.

    uv run python projects/demo-psx/build.py    ->  build/DEMOQ_PS1.EXE (+ .elf with symbols)
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
DEMO = HERE.parent / "demo-rom" / "src"
GAME = HERE.parent / "demo-n64" / "original"
ZLIB = HERE.parent / "zlib-n64"
ZLIB_UNITS = ["adler32", "compress", "crc32", "deflate", "inflate", "infblock", "infcodes", "inffast", "inftrees",
              "infutil", "trees", "uncompr", "zutil"]
LOAD = 0x80010000


def run(argv):
    res = subprocess.run(argv, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, argv))}\n{res.stdout}{res.stderr}")


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir()
    tc = toolchains.get("gcc-2.7.2-psx")
    d = str(toolchains.require(tc.id))
    cc = [a.replace("{tc}", d) for a in tc.cc]
    jobs = [(HERE / "crt0.s", []), (DEMO / "main.c", [f"-I{GAME}"]), (DEMO / "libc.c", []), (HERE / "psxrt.c", []),
            (GAME / "game.c", [f"-I{GAME}"])]
    jobs += [(ZLIB / "original" / f"{u}.c", [f"-I{ZLIB / 'sysinclude'}", f"-I{ZLIB / 'original'}"]) for u in ZLIB_UNITS]
    objs = []
    for src, extra in jobs:
        obj = BUILD / f"{src.stem}.o"
        run([*cc, *tc.flags, *extra, str(src), "-o", str(obj)])
        objs.append(obj)
    elf = BUILD / "demoq_ps1.elf"
    run(["ld.lld", "-m", "elf32ltsmip", "-T", str(HERE / "exe.ld"), "--no-check-sections", "-o", str(elf), *map(str, objs)])
    text = BUILD / "text.bin"
    run(["llvm-objcopy", "-O", "binary", "--only-section=.text", "--only-section=.rodata", "--only-section=.data",
         "--only-section=.sdata", str(elf), str(text)])
    body = text.read_bytes()
    body += b"\0" * (-len(body) % 2048)
    nm = subprocess.run(["llvm-nm", str(elf)], capture_output=True, text=True).stdout
    syms = {f[2]: int(f[0], 16) for f in (line.split() for line in nm.splitlines()) if len(f) == 3}
    header = bytearray(2048)
    header[0:8] = b"PS-X EXE"
    struct.pack_into("<IIIIIIIIIIII", header, 0x10, syms["_start"], syms["_gp"], LOAD, len(body), 0, 0,
                     syms["_bss_start"], syms["_bss_end"] - syms["_bss_start"], 0x801FFF00, 0, 0, 0)
    header[0x4C:0x4C + 40] = b"Demo Quest PS1 - made for decomp.wtf".ljust(40, b"\0")
    out = BUILD / "DEMOQ_PS1.EXE"
    out.write_bytes(bytes(header) + body)
    text.unlink()
    print(f"built {out.relative_to(HERE)}: {len(body)} bytes of code+data, gp=0x{syms['_gp']:08X}")


if __name__ == "__main__":
    main()
