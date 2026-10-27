"""Build Demo Quest DS, a Nintendo DS ROM made only from code we may share: the same Demo Quest game, main loop and
tiny libc as the N64 demo (CC0, ../demo-rom/src, ../demo-n64/original) and zlib 1.1.4 (Zlib license), compiled with
CodeWarrior for DS 2.0 (the flags DS decomps use) and linked by CodeWarrior's linker, with a NitroSDK-style ARM9
layout (crt0.s, demo.lcf) so that the community's ds-decomp reads it like a real game. The ROM itself is written here, then rebuilt by ds-decomp's own
`rom extract` and `rom build` so it's in the exact form the tools produce.

CodeWarrior is proprietary: this needs the `mwccarm` toolchain (decompnet toolchain install mwccarm --accept-license).

    uv run python projects/demo-ds/build.py    ->  build/demoquest.nds (+ build/demoq_ds.elf with symbols)
"""

from __future__ import annotations

import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from elftools.elf.elffile import ELFFile

from decompnet import toolchains

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
DEMO = HERE.parent / "demo-rom" / "src"
GAME = HERE.parent / "demo-n64" / "original"
ZLIB = HERE.parent / "zlib-n64"
ZLIB_UNITS = ["adler32", "compress", "crc32", "deflate", "inflate", "infblock", "infcodes", "inffast", "inftrees",
              "infutil", "trees", "uncompr", "zutil"]
CFLAGS = ["-O4,p", "-enum", "int", "-char", "signed", "-str", "noreuse", "-proc", "arm946e", "-gccext,on", "-fp", "soft",
          "-inline", "noauto", "-lang=c", "-Cpp_exceptions", "off", "-RTTI", "off", "-interworking", "-w", "off",
          "-gccinc", "-nolink", "-msgstyle", "gcc"]
MWCC = ("2.0", "sp1p5")
ITCM, DTCM, ARM9, ARM7 = 0x01FF8000, 0x027E0000, 0x02000000, 0x02380000


def run(argv, cwd=BUILD):
    res = subprocess.run([str(a) for a in argv], capture_output=True, text=True, cwd=cwd)
    if res.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, argv))}\n{res.stdout}{res.stderr}")
    return res.stdout


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


# The header's logo: a 104x16 bitmap, delta-coded per 16 bits and Huffman-coded per nibble (codes from ds-rom, MIT).
# This one is blank: the console only checks it at boot, and the real one is Nintendo's artwork.
LOGO_CODES = [(1, 0b1), (4, 0b0110), (5, 0b01010), (4, 0b0100), (5, 0b00010), (6, 0b011110), (6, 0b010110),
              (6, 0b000110), (5, 0b00110), (6, 0b011111), (6, 0b010111), (6, 0b000111), (4, 0b0010), (5, 0b01110),
              (5, 0b00111), (4, 0b0000)]


def blank_logo() -> bytes:
    data = struct.pack("<I", 0x0000D082) + bytes(104 * 16 // 8) + struct.pack("<I", 0xFFF4C307)
    bits = "".join(format(LOGO_CODES[n][1], f"0{LOGO_CODES[n][0]}b") for b in data for n in (b & 15, b >> 4))
    bits += "0" * (-len(bits) % 8)
    raw = bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))[:0x9C].ljust(0x9C, b"\0")
    return b"".join(raw[i:i + 4][::-1] for i in range(0, 0x9C, 4))


def arm9_binary(elf_path: Path) -> tuple[bytes, int, int]:
    """(ARM9 program: main part, autoload blocks and infos; build info offset; autoload callback address)."""
    elf = ELFFile(open(elf_path, "rb"))
    syms = {s.name: s["st_value"] for s in elf.get_section_by_name(".symtab").iter_symbols()}
    image = bytearray((BUILD / "arm9.bin").read_bytes())
    blocks = ARM9 + len(image)
    assert blocks == syms["__autoload_blocks"], (hex(blocks), hex(syms["__autoload_blocks"]))
    infos = b""
    for name, base in (("itcm.bin", ITCM), ("dtcm.bin", DTCM)):
        data = (BUILD / name).read_bytes()
        image += data
        infos += struct.pack("<III", base, len(data), 0)
    start = ARM9 + len(image)
    image += infos
    build_info = syms["_start_ModuleParams"] - ARM9
    struct.pack_into("<III", image, build_info, start, start + len(infos), blocks)
    return bytes(image), build_info, syms["_start_AutoloadDoneCallback"]


def nds(arm9: bytes, build_info: int, callback: int) -> bytes:
    """A DS ROM: header, ARM9 (+ footer), ARM7, file name and allocation tables, banner."""
    rom = bytearray(0x4000)
    arm9_off = 0x4000
    rom += arm9 + struct.pack("<III", 0xDEC00621, build_info, 0)  # the ARM9 footer points at the build info
    rom += bytes(-len(rom) % 0x200)
    arm7 = struct.pack("<I", 0xEAFFFFFE) + bytes(0x1FC)  # b . (the ARM7 just waits)
    arm7_off = len(rom)
    rom += arm7
    name, text = b"readme.txt", b"Demo Quest DS: a homemade ROM for decomp.wtf (CC0).\n"
    fnt_off = len(rom)
    fnt = struct.pack("<IHH", 8, 0, 1) + bytes([len(name)]) + name + b"\0"  # the root directory: one file
    rom += fnt + bytes(-len(fnt) % 0x200)
    fat_off = len(rom)
    rom += bytes(8) + bytes(-8 % 0x200)  # its allocation, filled in below
    banner_off = len(rom)
    banner = bytearray(0x840)
    struct.pack_into("<H", banner, 0, 1)
    title = "Demo Quest DS\ndecomp.wtf".encode("utf-16-le")
    for lang in range(6):
        banner[0x240 + lang * 0x100:0x240 + lang * 0x100 + len(title)] = title
    struct.pack_into("<H", banner, 2, crc16(bytes(banner[0x20:0x840])))
    rom += banner
    rom += bytes(-len(rom) % 0x200)
    struct.pack_into("<II", rom, fat_off, len(rom), len(rom) + len(text))
    rom += text + bytes(-len(text) % 4)
    h = bytearray(0x200)
    h[0:12] = b"DEMOQUESTDS\0"
    h[12:16] = b"ADQE"
    h[16:18] = b"00"
    size = 0x20000
    while size < len(rom):
        size <<= 1
    h[0x14] = (size // 0x20000).bit_length() - 1
    struct.pack_into("<IIII", h, 0x20, arm9_off, ARM9 + 0x800, ARM9, len(arm9))
    struct.pack_into("<IIII", h, 0x30, arm7_off, ARM7, ARM7, len(arm7))
    struct.pack_into("<IIII", h, 0x40, fnt_off, len(fnt), fat_off, 8)
    struct.pack_into("<II", h, 0x60, 0x00586000, 0x001808F8)
    struct.pack_into("<I", h, 0x68, banner_off)
    struct.pack_into("<H", h, 0x6E, 0x051E)
    struct.pack_into("<II", h, 0x70, callback, 0)
    struct.pack_into("<II", h, 0x80, len(rom), 0x4000)
    h[0xC0:0x15C] = blank_logo()
    rom[0:0x200] = h
    struct.pack_into("<H", rom, 0x6C, crc16(bytes(rom[0x4000:0x8000])))
    struct.pack_into("<H", rom, 0x15C, crc16(bytes(rom[0xC0:0x15C])))
    struct.pack_into("<H", rom, 0x15E, crc16(bytes(rom[0:0x15E])))
    return bytes(rom)


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    (BUILD / "src").mkdir(parents=True)
    for name, src in (("demo", DEMO), ("game", GAME), ("zlib", ZLIB / "original"), ("sysinclude", ZLIB / "sysinclude")):
        shutil.copytree(src, BUILD / "src" / name)
    for name in ("dsrt.c", "dsplat.c"):
        shutil.copy(HERE / name, BUILD / "src" / name)
    mw = toolchains.require("mwccarm") / "mwccarm" / MWCC[0] / MWCC[1] / "mwccarm.exe"
    wibo = [str(toolchains.binary("wibo"))] if sys.platform != "win32" else []
    if sys.platform == "win32":  # CodeWarrior's license check looks in C:\flexlm unless told where the license is
        os.environ.setdefault("LM_LICENSE_FILE", str(mw.parents[2] / "license.dat"))
    arm = toolchains.ensure("arm-gnu", log=print) / "bin"
    jobs = [("src/dsrt.c", []), ("src/dsplat.c", []), ("src/demo/main.c", ["-i", "src/game"]), ("src/demo/libc.c", []),
            ("src/game/game.c", ["-i", "src/game"])]
    jobs += [(f"src/zlib/{u}.c", ["-i", "src/sysinclude", "-i", "src/zlib"]) for u in ZLIB_UNITS]
    objs = []
    for src, extra in jobs:
        obj = f"{Path(src).stem}.o"
        run([*wibo, mw, *CFLAGS, *extra, "-c", src, "-o", obj])
        objs.append(obj)
    shutil.copy(HERE / "crt0.s", BUILD / "crt0.s")
    run([arm / "arm-none-eabi-as", "-mcpu=arm946e-s", "-o", "crt0.o", "crt0.s"])
    shutil.copy(HERE / "demo.lcf", BUILD / "demo.lcf")
    run([*wibo, mw.with_name("mwldarm.exe"), "-proc", "arm946e", "-nostdlib", "-interworking", "-nodead", "-m", "_start",
         "-map", "closure", "-o", "demoq_ds.elf", "crt0.o", *objs, "demo.lcf"])
    arm9, build_info, callback = arm9_binary(BUILD / "demoq_ds.elf")
    (BUILD / "raw.nds").write_bytes(nds(arm9, build_info, callback))
    # in the form ds-decomp builds it: extract and rebuild once, then check that it round-trips exactly
    dsd = str(toolchains.binary("dsd") if toolchains.installed("dsd") else toolchains.ensure("dsd") / "dsd")
    run([dsd, "rom", "extract", "--rom", "raw.nds", "--output-path", "x1"])
    run([dsd, "rom", "build", "--config", "x1/config.yaml", "--rom", "demoquest.nds"])
    run([dsd, "rom", "extract", "--rom", "demoquest.nds", "--output-path", "x2"])
    run([dsd, "rom", "build", "--config", "x2/config.yaml", "--rom", "again.nds"])
    if (BUILD / "again.nds").read_bytes() != (BUILD / "demoquest.nds").read_bytes():
        sys.exit("ds-decomp doesn't rebuild the demo ROM identically")
    for tmp in ("x1", "x2", "again.nds", "raw.nds"):
        shutil.rmtree(BUILD / tmp) if (BUILD / tmp).is_dir() else (BUILD / tmp).unlink()
    print(f"built build/demoquest.nds ({(BUILD / 'demoquest.nds').stat().st_size} bytes)")


if __name__ == "__main__":
    main()
