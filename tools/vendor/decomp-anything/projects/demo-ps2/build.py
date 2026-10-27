"""Build Demo Quest PS2, a PlayStation 2 executable made only from code we may share: the same Demo Quest game,
main loop and tiny libc as the N64 demo (CC0, ../demo-rom/src, ../demo-n64/original) and zlib 1.1.4 (Zlib
license), compiled with EE-GCC 2.96 at -O2 -G8 and linked at 0x00100000 like PS2 games.

    uv run python projects/demo-ps2/build.py    ->  build/SLUS_999.99 (stripped, like a game) + build/demoq_ps2.elf
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from decompnet import toolchains
from decompnet.compiler import run_in
from decompnet.project import compiler_config

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
DEMO = HERE.parent / "demo-rom" / "src"
GAME = HERE.parent / "demo-n64" / "original"
ZLIB = HERE.parent / "zlib-n64"
ZLIB_UNITS = ["adler32", "compress", "crc32", "deflate", "inflate", "infblock", "infcodes", "inffast", "inftrees",
              "infutil", "trees", "uncompr", "zutil"]


def run(argv, cwd=None):
    res = subprocess.run(argv, capture_output=True, text=True, cwd=cwd)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, argv))}\n{res.stdout}{res.stderr}")


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    (BUILD / "src").mkdir(parents=True)
    # EE-GCC is a 32-bit Linux program: run it in decomp.wtf's compiler sandbox, on copies of the sources
    for name, src in (("demo", DEMO), ("game", GAME), ("zlib", ZLIB / "original"), ("sysinclude", ZLIB / "sysinclude")):
        shutil.copytree(src, BUILD / "src" / name)
    shutil.copy(HERE / "crt0.s", BUILD / "src" / "crt0.s")
    shutil.copy(HERE / "ps2rt.c", BUILD / "src" / "ps2rt.c")
    cfg = compiler_config(BUILD, {"compiler": {"toolchain": "ee-gcc-2.96"}})
    cc = cfg.cmd[:cfg.cmd.index("-I{include}")]  # driver + -c
    cc = [a for a in cc if a not in ("-O2", "-G0")]
    jobs = [("src/crt0.s", []), ("src/demo/main.c", ["-Isrc/game"]), ("src/demo/libc.c", []), ("src/ps2rt.c", []),
            ("src/game/game.c", ["-Isrc/game"])]
    jobs += [(f"src/zlib/{u}.c", ["-Isrc/sysinclude", "-Isrc/zlib"]) for u in ZLIB_UNITS]
    objs = []
    for src, extra in jobs:
        obj = f"{Path(src).stem}.o"
        res = run_in(cfg, BUILD, [*cc, "-O2", "-G8", *extra, src, "-o", obj], inputs=["src"], outputs=[obj])
        if res.returncode != 0:
            sys.exit(f"failed: {src}\n{res.stdout}{res.stderr}")
        objs.append(obj)
    elf = BUILD / "demoq_ps2.elf"
    # the EE assembler writes .rel and .rela sections for the same section, which only GNU ld links
    ld = str(toolchains.binary("binutils-mips").parent / "mips-ps2-decompals-ld")
    run([ld, "-EL", "-T", str(HERE / "elf.ld"), "-o", str(elf), *objs], cwd=BUILD)
    game = BUILD / "SLUS_999.99"
    run(["llvm-objcopy", "--strip-all", str(elf), str(game)])
    print(f"built {game.relative_to(HERE)} ({game.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
