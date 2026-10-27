"""Build Demo Quest GC, a GameCube program (DOL) made only from code we may share: the same Demo Quest game, main loop
and tiny libc as the N64 demo (CC0, ../demo-rom/src, ../demo-n64/original) and zlib 1.1.4 (Zlib license), compiled
with CodeWarrior for GameCube 1.3.2 (-O4,p, dtk-template's usual flags) and linked by CodeWarrior's linker with its
standard DOL layout, like GameCube games.

CodeWarrior is proprietary: this needs the `mwcc` toolchain (decompnet toolchain install mwcc --accept-license).

    uv run python projects/demo-gc/build.py    ->  build/main.dol (+ build/demoq_gc.elf with symbols)
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
CFLAGS = ["-nodefaults", "-proc", "gekko", "-align", "powerpc", "-enum", "int", "-fp", "hardware", "-Cpp_exceptions",
          "off", "-O4,p", "-inline", "auto", "-nosyspath", "-RTTI", "off", "-fp_contract", "on", "-str", "reuse"]


def run(argv, cwd=BUILD):
    res = subprocess.run([str(a) for a in argv], capture_output=True, text=True, cwd=cwd)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, argv))}\n{res.stdout}{res.stderr}")


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    (BUILD / "src").mkdir(parents=True)
    for name, src in (("demo", DEMO), ("game", GAME), ("zlib", ZLIB / "original"), ("sysinclude", ZLIB / "sysinclude")):
        shutil.copytree(src, BUILD / "src" / name)
    mw = toolchains.require("mwcc") / "GC" / "1.3.2" / "mwcceppc.exe"
    wibo = [str(toolchains.binary("wibo"))] if sys.platform != "win32" else []
    for name in ("crt0.c", "ppcrt.c"):
        shutil.copy(HERE / name, BUILD / "src" / name)
    jobs = [("src/crt0.c", []), ("src/ppcrt.c", []), ("src/demo/main.c", ["-i", "src/game"]), ("src/demo/libc.c", []),
            ("src/game/game.c", ["-i", "src/game"])]
    jobs += [(f"src/zlib/{u}.c", ["-i", "src/sysinclude", "-i", "src/zlib"]) for u in ZLIB_UNITS]
    objs = []
    for src, extra in jobs:
        obj = f"{Path(src).stem}.o"
        run([*wibo, mw, *CFLAGS, *extra, "-c", src, "-o", obj])
        objs.append(obj)
    # linked by CodeWarrior's own linker, like GameCube games (it also writes the start-up tables). Keep every function,
    # even ones nothing calls, so the demo has all of Demo Quest to decompile (FORCEACTIVE, CodeWarrior's way).
    from elftools.elf.elffile import ELFFile

    keep = set()
    for obj in objs:
        with open(BUILD / obj, "rb") as f:
            for sym in ELFFile(f).get_section_by_name(".symtab").iter_symbols():
                if sym["st_info"]["type"] == "STT_FUNC" and sym["st_info"]["bind"] == "STB_GLOBAL" and sym["st_shndx"] != "SHN_UNDEF":
                    keep.add(sym.name)
    lcf = (HERE / "demo.lcf").read_text().replace("FORCEACTIVE\n{\n}", "FORCEACTIVE\n{\n" + "".join(f"    {n}\n" for n in sorted(keep)) + "}")
    (BUILD / "demo.lcf").write_text(lcf)
    run([*wibo, mw.with_name("mwldeppc.exe"), "-fp", "hardware", "-nodefaults", "-lcf", "demo.lcf", "-o", "demoq_gc.elf", *objs])
    run([toolchains.binary("dtk"), "elf2dol", "demoq_gc.elf", "main.dol"])
    print(f"built build/main.dol ({(BUILD / 'main.dol').stat().st_size} bytes)")


if __name__ == "__main__":
    main()
