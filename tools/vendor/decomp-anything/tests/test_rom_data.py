"""Data a submission defines itself (strings, float constants, tables) is judged by what the game has where the
code points, whatever the order the code uses it in and however the game's linker laid it out.

The game here is linked from hand-written assembly with the very instructions KMC GCC makes for `b`, but its
data the way IDO-era games keep it: the string shared with an earlier function first, then the next function's
string right after "hey" (no padding), constants at the end. Compiled alone, the submission has "hey" padded,
then "hello", then the double. Every one of those must be found equal; a wrong one must not.
"""

import shutil
import subprocess
from io import BytesIO
from pathlib import Path

import pytest
from elftools.elf.elffile import ELFFile

from decompnet import toolchains
from decompnet.compiler import CompilerConfig, compile_source
from decompnet.rom import match
from decompnet.rom.symbols import Symbol, SymbolTable

pytestmark = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-kmc and ld.lld")

GAME = """
    .set noreorder
    .text
    .globl show
show:
    jr $31
    nop
    .globl showd
showd:
    jr $31
    nop
    .globl a
a:
    addiu $sp,$sp,-24
    lui $4,%hi(s_hello)
    addiu $4,$4,%lo(s_hello)
    sw $31,16($sp)
    jal show
    nop
    lw $31,16($sp)
    jr $31
    addiu $sp,$sp,24
    .globl b
b:
    addiu $sp,$sp,-24
    lui $4,%hi(s_hey)
    addiu $4,$4,%lo(s_hey)
    sw $31,16($sp)
    jal show
    nop
    lui $1,%hi(k_2_5)
    jal showd
    ldc1 $f12,%lo(k_2_5)($1)
    lui $4,%hi(s_hello)
    jal show
    addiu $4,$4,%lo(s_hello)
    lw $31,16($sp)
    jr $31
    addiu $sp,$sp,24
    nop
    .globl c
c:
    lui $4,%hi(s_next)
    j show
    addiu $4,$4,%lo(s_next)

    .section .rodata
s_hello: .asciz "hello"
    .align 3
s_hey: .asciz "hey"
s_next: .asciz "next"
    .align 3
k_2_5: .double 2.5
"""

SOURCE = """extern void show(const char *);
extern void showd(double);
void b(void) { show("%s"); showd(%s); show("%s"); }
"""


@pytest.fixture(scope="module")
def game(tmp_path_factory):
    work = tmp_path_factory.mktemp("game")
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    (work / "game.s").write_text(GAME)
    subprocess.run([f"{tc_dir}/as", "-mips3", "-G0", "-EB", "-o", str(work / "game.o"), str(work / "game.s")],
                   check=True)
    (work / "game.ld").write_text("SECTIONS { . = 0x80000400; .text : { *(.text) } .rodata : { *(.rodata) } }")
    subprocess.run(["ld.lld", "-m", "elf32btsmip", "-T", str(work / "game.ld"), "-o", str(work / "game.elf"),
                    str(work / "game.o")], check=True)
    elf = ELFFile(BytesIO((work / "game.elf").read_bytes()))
    syms = {s.name: s["st_value"] for s in elf.get_section_by_name(".symtab").iter_symbols() if s.name}
    image = {}
    for name in (".text", ".rodata"):
        sec = elf.get_section_by_name(name)
        image[sec["sh_addr"]] = sec.data()

    def read(addr, n):
        for base, data in image.items():
            if base <= addr and addr + n <= base + len(data):
                return data[addr - base:addr - base + n]
        return None

    text = elf.get_section_by_name(".text")
    code = read(syms["b"], 0x3C)  # without the alignment nop after it, like the compiled function
    hi, lo, r26 = match.R_MIPS_HI16, match.R_MIPS_LO16, match.R_MIPS_26
    relocs = [(0x04, hi, syms["s_hey"]), (0x08, lo, syms["s_hey"]), (0x10, r26, syms["show"]),
              (0x18, hi, syms["k_2_5"]), (0x1C, r26, syms["showd"]), (0x20, lo, syms["k_2_5"]),
              (0x24, hi, syms["s_hello"]), (0x28, r26, syms["show"]), (0x2C, lo, syms["s_hello"])]
    assert text["sh_addr"] <= syms["b"]
    return syms, read, match.RomTarget("b", syms["b"], code, relocs)


def tables(syms):
    """What a project knows: only the functions' names, or every label splat gives the data too."""
    funcs = [Symbol(n, syms[n], 0, "func") for n in ("show", "showd", "a", "b", "c")]
    labels = [Symbol(f"D_{syms[n]:08X}", syms[n], 0, "data") for n in ("s_hello", "s_hey", "s_next", "k_2_5")]
    return {"functions only": SymbolTable(funcs), "splat labels": SymbolTable(funcs + labels)}


def judge(game, hey="hey", k="2.5", hello="hello"):
    syms, read, target = game
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = str(toolchains.require(tc.id))
    cmd = [a.replace("{tc}", tc_dir) for a in tc.cc] + tc.flags + ["-I{include}", "{src}", "-o", "{obj}"]
    res = compile_source(CompilerConfig(cmd=cmd, ro_paths=(tc_dir,)), "", SOURCE % (hey, k, hello))
    assert res.ok, res.log
    return {name: match.link(res.obj, "b", target, table, read) for name, table in tables(syms).items()}


def test_own_data_in_another_layout_matches(game):
    for name, linked in judge(game).items():
        assert linked.exact, (name, linked.problems)


@pytest.mark.parametrize("change", [{"hey": "hez"}, {"hello": "hellp"}, {"k": "2.25"}, {"hey": "he"},
                                    {"hello": "hell"}])
def test_wrong_data_is_caught(game, change):
    for name, linked in judge(game, **change).items():
        assert not linked.exact and linked.problems, (name, change)


PICK = """const char *pick(int i) {
    static const char *const names[] = {"%s", "%s", "%s"};
    if (i < 0) return "%s";
    return names[i];
}
"""
BASE = 0x08000000


def _agbcc(source: str) -> bytes:
    from decompnet.project import compiler_config

    res = compile_source(compiler_config(Path("."), {"compiler": {"toolchain": "agbcc"}}), "", source)
    assert res.ok, res.log
    return res.obj


@pytest.fixture(scope="module")
def gba_game():
    """The original: pick() at 0x08000200, its strings packed differently (other data right after "zero"), its
    table elsewhere, every pointer an absolute address."""
    if any(toolchains.installed(t) is None for t in ("agbcc", "arm-gnu")):
        pytest.skip("needs agbcc and the Arm GNU toolchain")
    obj = ELFFile(BytesIO(_agbcc(PICK % ("zero", "one", "two", "neg"))))
    rodata = obj.get_section_by_name(".rodata").data()
    places = {"neg": 0x08001000, "zero": 0x08001004, "one": 0x08001010, "two": 0x08001014, "names": 0x08001020}
    image = bytearray(0x2000)

    def put(addr, data):
        image[addr - BASE:addr - BASE + len(data)] = data

    for s in ("neg", "zero", "one", "two"):
        put(places[s], s.encode() + b"\0")
    put(0x08001009, b"\x01\x02\x03")  # someone else's data right after "zero\0"
    put(places["names"], b"".join(places[s].to_bytes(4, "little") for s in ("zero", "one", "two")) + b"\xef\xbe\xad\xde")
    where = {rodata.find(s.encode() + b"\0"): places[s] for s in ("neg",)} | {0: places["names"]}
    code = bytearray(obj.get_section_by_name(".text").data()[:0x24])
    for rel in obj.get_section_by_name(".rel.text").iter_relocations():
        at = rel["r_offset"]
        code[at:at + 4] = where[int.from_bytes(code[at:at + 4], "little")].to_bytes(4, "little")
    put(0x08000200, code)

    def read(addr, n):
        return bytes(image[addr - BASE:addr - BASE + n]) if addr >= BASE and addr + n <= BASE + len(image) else None

    from decompnet.rom.match_arm import ArmTarget

    labels = [Symbol(f"gUnknown_{a:08X}", a, 0, "data") for a in (*places.values(), 0x08001009)]
    return read, ArmTarget("pick", 0x08000200, bytes(code)), {"no labels": SymbolTable([]),
                                                               "labels": SymbolTable(labels)}


def judge_gba(gba_game, names=("zero", "one", "two"), neg="neg"):
    from decompnet.rom import match_arm

    read, target, symbol_tables = gba_game
    obj = _agbcc(PICK % (*names, neg))
    return {name: match_arm.link(obj, "pick", target, table, read) for name, table in symbol_tables.items()}


def test_gba_strings_and_pointer_tables_match(gba_game):
    for name, linked in judge_gba(gba_game).items():
        assert linked.exact, (name, linked.problems)


@pytest.mark.parametrize("change", [{"neg": "neq"}, {"names": ("zero", "one", "tw0")},
                                    {"names": ("one", "zero", "two")}, {"names": ("zero", "on", "two")}])
def test_gba_wrong_data_is_caught(gba_game, change):
    for name, linked in judge_gba(gba_game, **change).items():
        assert not linked.exact and linked.problems, (name, change)
