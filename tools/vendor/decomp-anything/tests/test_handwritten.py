"""Code no compiler makes (handwritten.py): CodeWarrior's runtime helpers, which take their input in r11/r12 (each
Mario Party 6 module links copies of them), are taken out of agents' way; compiled code never is."""

import struct
import subprocess

import pytest

from decompnet import toolchains
from decompnet.app.twins import object_prints
from decompnet.handwritten import ppc_reason


def code(*words: int) -> bytes:
    return b"".join(struct.pack(">I", w) for w in words)


PTMF_THUNK = code(0x800C0000, 0x816C0004, 0x818C0008, 0x2C0B0000, 0x7C630214)  # lwz r0,0(r12)...: fn_1_E428
COPY = code(0x80040000, 0x7C001A14, 0x90050000, 0x7CA32B78, 0x4E800020)  # lwz r0,0(r4); add r0,r0,r3...: fn_1_E4E0


def test_runtime_helpers_are_assembly():
    assert ppc_reason(PTMF_THUNK).startswith("reads r12 before setting it")
    assert ppc_reason(code(0x91CBFFB8)).startswith("reads r11 before setting it")  # stw r14,-72(r11): __save_gpr
    assert ppc_reason(code(0x7D8903A6, 0x4E800420)).startswith("reads r12")  # mtctr r12; bctr


def test_compiled_code_is_not():
    assert ppc_reason(COPY) is None  # r0 is set before it's read
    # stwu r1; mflr r0; stw r0; bl: after a call (or any branch) nothing is looked at, r12 included
    assert ppc_reason(code(0x9421FFF0, 0x7C0802A6, 0x90010014, 0x48000001, 0x818C0008)) is None
    assert ppc_reason(code(0x60000000, 0x38000000, 0x80600010, 0x4E800020)) is None  # nop; li r0,0; lwz r3,16(0)
    assert ppc_reason(code(0x7C0004AC, 0x4E800020)) is None  # sync: C has it too, from the SDK's inline helpers
    assert ppc_reason(b"") is None and ppc_reason(code(0)) is None


@pytest.mark.skipif(toolchains.installed("gc-wii-binutils") is None, reason="needs the GameCube binutils")
def test_fingerprints_say_which_code_is_assembly(tmp_path):
    (tmp_path / "x.s").write_text("""
    .text
    .globl __ptmf_scall
    .type __ptmf_scall, @function
__ptmf_scall:
    lwz r0, 0(r12)
    lwz r11, 4(r12)
    lwz r12, 8(r12)
    add r3, r3, r0
    cmpwi r11, 0
    blt 1f
    lwzx r12, r3, r12
    lwzx r12, r12, r11
1:  mtctr r12
    bctr
    .size __ptmf_scall, .-__ptmf_scall
    .globl copy
    .type copy, @function
copy:
    lwz r0, 0(r4)
    add r0, r0, r3
    stw r0, 0(r5)
    mr r3, r5
    blr
    .size copy, .-copy
""")
    gas = toolchains.path("gc-wii-binutils") / "powerpc-eabi-as"
    subprocess.run([str(gas), "-mgekko", "-mregnames", "-o", str(tmp_path / "x.o"), str(tmp_path / "x.s")], check=True)
    prints = object_prints((tmp_path / "x.o").read_bytes())
    assert prints["__ptmf_scall"].asm.startswith("reads r12") and prints["copy"].asm == ""


def le(*words: int) -> bytes:
    return b"".join(struct.pack("<I", w) for w in words)


def test_mips_code_no_compiler_makes():
    """#22 (a PS1 game): agents spent their turns on a one-instruction piece that runs into the next function, and on
    PSY-Q's libgte (ctc2: the GTE, which C can't drive without inline asm)."""
    from decompnet.handwritten import mips_reason

    assert mips_reason(le(0x8D110024), False, "psx").startswith("ends without a return")  # lw s1, 0x24(t0)
    assert "GTE" in mips_reason(le(0x48C4D000, 0x03E00008, 0), False, "psx")  # ctc2 a0, $26; jr ra; nop
    assert "coprocessor 0" in mips_reason(le(0x40026000, 0x03E00008, 0), False, "n64")  # mfc0 v0, Status
    assert mips_reason(le(0x8D020000, 0x03E00008, 0), False, "psx").startswith("reads t0")  # lw v0, 0(t0); jr ra
    # compiled code: a prologue, a call, the epilogue; on the PS2, t0-t3 carry arguments
    prologue = le(0x27BDFFE8, 0xAFBF0010, 0x0C000000, 0, 0x8FBF0010, 0x03E00008, 0x27BD0018)
    assert mips_reason(prologue, False, "psx") is None
    assert mips_reason(le(0x8D020000, 0x03E00008, 0), False, "ps2") is None  # lw v0, 0(t0) on the PS2: an argument
    assert mips_reason(le(0x03E00008, 0, 0, 0), False, "psx") is None  # alignment padding after jr ra
