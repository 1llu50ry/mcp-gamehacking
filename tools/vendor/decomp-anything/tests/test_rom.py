"""ROM pipeline: split a real (homemade) N64 ROM with splat and prove the matcher on it.

Demo Quest 64 (projects/demo-rom) is built from code we may share, with the same period compiler a
1990s N64 game used. Compiling its original source and linking each function against the bytes
splat took from the ROM must reproduce every function exactly; mangling one must not.
"""

import shutil
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import pytest
from elftools.elf.elffile import ELFFile

from decompnet import toolchains
from decompnet.compiler import CompilerConfig, compile_source
from decompnet.elfobj import _canonical, list_functions
from decompnet.rom import match, n64, split
from decompnet.rom.symbols import Symbol, SymbolTable

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "projects" / "demo-rom"
ROM = DEMO / "build" / "demo-quest-64.z64"
ELF = DEMO / "build" / "demo-quest-64.elf"

pytestmark = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-kmc and ld.lld to build the demo ROM")


@pytest.fixture(scope="module")
def built():
    if not ROM.exists():
        subprocess.run([sys.executable, str(DEMO / "build.py")], check=True)
    return ROM.read_bytes()


@pytest.fixture(scope="module")
def splitres(built, tmp_path_factory):
    work = tmp_path_factory.mktemp("split")
    rom, info = n64.read_info(built)
    (work / "rom.z64").write_bytes(rom)
    return split.split_rom(work, log=lambda *_: None), rom, info


def truth() -> SymbolTable:
    """Every symbol of the original link, as if a user had named everything."""
    elf = ELFFile(BytesIO(ELF.read_bytes()))
    syms = []
    for s in elf.get_section_by_name(".symtab").iter_symbols():
        kind = s["st_info"]["type"]
        if kind not in ("STT_FUNC", "STT_OBJECT") or not s.name or s.name.endswith("."):
            continue
        syms.append(Symbol(_canonical(s.name, s["st_info"]["bind"]), s["st_value"], s["st_size"],
                           "func" if kind == "STT_FUNC" else "data"))
    return SymbolTable(syms)


def reader(rom: bytes, segments):
    def read(addr, n):
        for seg in segments:
            if seg.contains(addr, n):
                at = seg.rom_start + addr - seg.vram
                return rom[at:at + n]
        return None
    return read


def test_header_and_byte_orders(built):
    rom, info = n64.read_info(built)
    assert info.title == "DEMO QUEST 64" and info.game_code == "NDQE" and info.region == "North America"
    assert info.entrypoint == 0x80000400 and info.compiler_guess == "KMC" and info.byte_order == "z64"
    v64 = bytearray(built)
    v64[0::2], v64[1::2] = built[1::2], built[0::2]
    assert n64.read_info(bytes(v64))[0] == rom
    with pytest.raises(n64.RomError):
        n64.read_info(b"\0" * 0x200000)


def resplit(functions):
    """Split what the disassembler merged, the way an agent would with split_function."""
    starts = sorted(s.address for s in truth().by_name.values() if s.kind == "func")
    out = []
    for fn in functions:
        cuts = [a for a in starts if fn.vram < a < fn.vram + fn.size]
        for a in cuts:
            fn, tail = split.split_function(fn, a, f"func_{a:08X}")
            out.append(fn)
            fn = tail
        out.append(fn)
    return out


def test_split_finds_every_function(splitres):
    res, _rom, _info = splitres
    elf_funcs = [s for s in truth().by_name.values() if s.kind == "func" and s.address >= 0x80000460]
    found = {f.vram for f in res.functions}
    missed = {s.address for s in elf_funcs} - found
    assert len(missed) <= 2  # e.g. exit(), which never returns, runs into the next function
    assert {s.address for s in elf_funcs} <= {f.vram for f in resplit(res.functions)}
    assert res.compiler == "KMC"
    assert any(s.kind == "string" and "1.1.4" in s.preview for s in res.data)  # zlibVersion()
    main = next(s for s in res.segments if s.name == "main")
    assert main.vram == 0x80000460 and main.rom_start == 0x1060


def _compile_units():
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    zlib = ROOT / "projects" / "zlib-n64"
    game = ROOT / "projects" / "demo-n64" / "original"
    units = [(DEMO / "src" / "main.c", [str(game)]), (DEMO / "src" / "libc.c", []), (game / "game.c", [str(game)])]
    units += [(p, [str(zlib / "sysinclude"), str(zlib / "original")])
              for p in sorted((zlib / "original").glob("*.c")) if (DEMO / "build" / f"{p.stem}.o").exists()]
    for src, incs in units:
        cmd = [a.replace("{tc}", tc_dir) for a in tc.cc] + tc.flags + [f"-I{i}" for i in incs] + ["-I{include}", "{src}", "-o", "{obj}"]
        res = compile_source(CompilerConfig(cmd=cmd, ro_paths=(tc_dir, *incs)), "", src.read_text(errors="replace"), trusted=True)
        assert res.ok, res.log
        yield src.stem, res.obj


def test_original_source_matches_the_rom_byte_for_byte(splitres):
    res, rom, _info = splitres
    symbols = truth()
    read = reader(rom, res.segments)
    by_vram = {f.vram: f for f in resplit(res.functions)}
    checked, failures = 0, []
    for unit, obj in _compile_units():
        for name in list_functions(obj):
            addr = symbols.resolve(name)
            fn = by_vram.get(addr)
            if fn is None:
                failures.append(f"{unit}:{name} not found in the split")
                continue
            target = match.target_from_split(fn, symbols.resolve)
            target.name = name
            result = match.link(obj, name, target, symbols, read)
            d = match.diff(match.canonical_target(target, symbols), result)
            checked += 1
            if not result.exact or d.score != 0:
                failures.append(f"{unit}:{name} score {d.score} {result.problems}\n{d.render()}")
    assert not failures, "\n\n".join(failures[:5])
    assert checked >= 90


def test_a_wrong_function_does_not_match(splitres):
    res, rom, _info = splitres
    symbols = truth()
    fn = next(f for f in resplit(res.functions) if f.vram == symbols.resolve("clamp_s32"))
    target = match.target_from_split(fn, symbols.resolve)
    target.name = "clamp_s32"
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    cmd = [a.replace("{tc}", tc_dir) for a in tc.cc] + tc.flags + ["-I{include}", "{src}", "-o", "{obj}"]
    cc = CompilerConfig(cmd=cmd, ro_paths=(tc_dir,))
    wrong = "int clamp_s32(int v, int lo, int hi) { if (v > hi) return hi; if (v < lo) return lo; return v; }"
    out = compile_source(cc, "", wrong)
    result = match.link(out.obj, "clamp_s32", target, symbols, reader(rom, res.segments))
    assert not result.exact
    assert match.diff(match.canonical_target(target, symbols), result).score > 0


def test_unknown_names_are_explained(splitres):
    res, rom, _info = splitres
    symbols = SymbolTable()  # nothing renamed: only automatic names resolve
    fn = next(f for f in res.functions if any(ln.mnemonic == "jal" for ln in f.lines))
    target = match.target_from_split(fn, symbols.resolve)
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    cmd = [a.replace("{tc}", tc_dir) for a in tc.cc] + tc.flags + ["-I{include}", "{src}", "-o", "{obj}"]
    src = f"void some_helper(void);\nvoid {fn.name}(void) {{ some_helper(); }}"
    out = compile_source(CompilerConfig(cmd=cmd, ro_paths=(tc_dir,)), "", src)
    result = match.link(out.obj, fn.name, target, symbols, reader(rom, res.segments))
    assert not result.exact and any("some_helper" in p for p in result.problems)
