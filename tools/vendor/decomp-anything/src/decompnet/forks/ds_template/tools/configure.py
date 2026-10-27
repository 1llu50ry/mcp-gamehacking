#!/usr/bin/env python3
"""Write build.ninja for this Nintendo DS decompilation, then run `ninja`.

    python tools/configure.py VERSION --dsd PATH --compilers DIR [--wibo PATH]

`ninja` builds everything and checks the ROM; `ninja prepare` only what decompiling needs; `ninja rom` the ROM check.
The build extracts your copy of the game (extract/baserom.nds), delinks its code into objects with ds-decomp (dsd),
compiles src/ with CodeWarrior for DS, links everything with CodeWarrior's linker, rebuilds the ROM and checks it
against your copy, byte for byte. objdiff.json (for objdiff and decomp.wtf) compares every source file with the
original. Made by decomp.wtf, modeled on the build of AetiasHax's Princess Maker 4 decomp (CC0).
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import ninja_syntax

# Settings (decomp.wtf wrote these for this game; change them if the game was built differently)
GAME = "game"
MWCC_VERSION = "2.0/sp1p5"
CC_FLAGS = ["-O4,p", "-enum", "int", "-char", "signed", "-str", "noreuse", "-proc", "arm946e", "-gccext,on", "-fp",
            "soft", "-inline", "noauto", "-Cpp_exceptions", "off", "-RTTI", "off", "-interworking", "-w", "off",
            "-sym", "on", "-gccinc", "-nolink", "-msgstyle", "gcc"]
LD_FLAGS = ["-proc", "arm946e", "-dead", "-nostdlib", "-interworking", "-map", "closure,unused", "-msgstyle", "gcc"]

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
parser = argparse.ArgumentParser(description="Writes build.ninja")
parser.add_argument("version", help="game version (a directory in config/)")
parser.add_argument("--dsd", required=True, help="path to ds-decomp's dsd")
parser.add_argument("--compilers", required=True, help="CodeWarrior for DS directory (holds 2.0/sp1p5/mwccarm.exe, ...)")
parser.add_argument("--wibo", default="", help="runs the Windows compilers on Linux and macOS")
args = parser.parse_args()

VERSION = args.version
CONFIG = Path("config") / VERSION / "arm9" / "config.yaml"
BUILD = Path("build") / VERSION
BASEROM = Path("extract") / "baserom.nds"
EXTRACT = Path("extract") / VERSION
CC = str(Path(args.compilers) / MWCC_VERSION / "mwccarm.exe")
LD = str(Path(args.compilers) / MWCC_VERSION / "mwldarm.exe")
WRAP = f'"{args.wibo}" ' if args.wibo and sys.platform != "win32" else ""
# Windows: ninja starts commands without a shell, so a rule with && runs through cmd; and CodeWarrior's license check
# only looks in C:\flexlm unless LM_LICENSE_FILE points at the license.dat next to the compilers
SH = "cmd /c " if sys.platform == "win32" else ""
LICENSE = Path(args.compilers).resolve() / "license.dat"
if sys.platform == "win32" and LICENSE.exists():
    WRAP = f'cmd /c set "LM_LICENSE_FILE={LICENSE}" && '
DSD = f'"{args.dsd}"'
PY = f'"{sys.executable}"'


def q(argv: list[str]) -> str:
    return subprocess.list2cmdline(argv)


def sources() -> list[Path]:
    return sorted(p for p in Path("src").rglob("*") if p.suffix in (".c", ".cpp"))


def main() -> None:
    delinks = json.loads(subprocess.run([args.dsd, "json", "delinks", "--config-path", str(CONFIG)], check=True,
                                        capture_output=True, text=True, encoding="utf-8", errors="replace").stdout)
    files = delinks["files"]
    dsd_configs = [str(p) for p in Path("config", VERSION).rglob("*.txt")]
    rom = BUILD / f"{GAME}.nds"
    with open("build.ninja", "w", encoding="utf-8") as f:
        n = ninja_syntax.Writer(f)
        n.rule("extract", f"{DSD} rom extract --rom $in --output-path {EXTRACT}")
        n.rule("delink", f"{DSD} delink --config-path {CONFIG}")
        n.rule("mwcc", f"{WRAP}\"{CC}\" {q(CC_FLAGS)} -i include $cflags -MD -c $in -o $basedir"
               + ("" if sys.platform == "win32" else f" && {PY} tools/transform_dep.py $basefile.d $basefile.d"),
               depfile="$basefile.d")
        n.rule("lcf", f"{DSD} lcf -c {CONFIG}")
        n.rule("mwld", f"{WRAP}\"{LD}\" {q(LD_FLAGS)} -m Entry @$objects $lcf -o $out")
        n.rule("rom_config", f"{DSD} rom config --elf $in --config {CONFIG}")
        n.rule("rom_build", f"{DSD} rom build --config $in --rom $out")
        n.rule("same", f"{PY} tools/same.py $in {BASEROM} $out")
        n.rule("objdiff", f"{DSD} objdiff --config-path {CONFIG} --custom-make ninja")
        n.rule("check", f"{SH}{DSD} check modules --config-path {CONFIG} --fail && {PY} tools/same.py --touch $out")
        n.rule("configure", f"{PY} tools/configure.py {q(sys.argv[1:])}", generator=True)

        n.build(str(EXTRACT / "config.yaml"), "extract", str(BASEROM))
        targets = sorted({x["delink_file"] for x in files})
        n.build(targets or ["delink"], "delink", [*dsd_configs, str(EXTRACT / "config.yaml")])
        objs = []
        for src in sources():
            obj = BUILD / src.with_suffix(".o")
            lang = "-lang=c++" if src.suffix == ".cpp" else "-lang=c"
            n.build(str(obj), "mwcc", str(src), variables={"cflags": lang, "basefile": str(obj.with_suffix("")),
                                                           "basedir": str(obj.parent)})
            objs.append(str(obj))
        lcf, objects = delinks["arm9_lcf_file"], delinks["arm9_objects_file"]
        n.build([lcf, objects], "lcf", [*dsd_configs, str(EXTRACT / "config.yaml")])
        linked = sorted({x["object_to_link"] for x in files})
        n.build(str(BUILD / "arm9.o"), "mwld", [*linked, lcf, objects], variables={"lcf": lcf, "objects": objects})
        rom_config = BUILD / "build" / "rom_config.yaml"
        n.build(str(rom_config), "rom_config", str(BUILD / "arm9.o"))
        n.build(str(rom), "rom_build", str(rom_config))
        n.build(str(BUILD / "rom.ok"), "same", str(rom))
        n.build(str(BUILD / "check.ok"), "check", str(BUILD / "arm9.o"))
        n.build("objdiff.json", "objdiff", dsd_configs)
        n.build("rom", "phony", str(BUILD / "rom.ok"))
        # what decompiling needs (each function is judged against its delinked original): `ninja prepare`; every
        # source file's object, keeping going past work in progress: `ninja -k 0 all_source`
        n.build("all_source", "phony", objs)
        n.build("prepare", "phony", ["objdiff.json", *targets, *objs])
        n.build("build.ninja", "configure", [__file__, *dsd_configs, *[str(s) for s in sources()]])
        n.default(["objdiff.json", str(BUILD / "rom.ok"), *objs])


if __name__ == "__main__":
    main()
