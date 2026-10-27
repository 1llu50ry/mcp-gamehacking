"""A DS game's rebuilt ROM against the user's copy (the DS template's tools/same.py): a trimmed copy is the same game,
and anything else that differs is named, part by part (issue #6: a Pokemon Platinum import stopped at "differs from
your copy" with nothing more to go on). Runs on the demo ROM's bytes; needs no compiler."""

import importlib.util
import struct
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ROM = ROOT / "projects" / "demo-ds" / "build" / "demoquest.nds"
SAME = ROOT / "src" / "decompnet" / "forks" / "ds_template" / "tools" / "same.py"

pytestmark = pytest.mark.skipif(not ROM.exists(), reason="needs the demo DS ROM (projects/demo-ds)")


@pytest.fixture(scope="module")
def same():
    spec = importlib.util.spec_from_file_location("ds_same", SAME)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(same, tmp_path, built: bytes, original: bytes, capsys):
    (tmp_path / "b.nds").write_bytes(built)
    (tmp_path / "o.nds").write_bytes(original)
    code = same.main([str(tmp_path / "b.nds"), str(tmp_path / "o.nds"), str(tmp_path / "rom.ok")])
    out = capsys.readouterr()
    return code, out.out + out.err, (tmp_path / "rom.ok").exists()


def test_trimmed_and_padded_copies_are_the_same_game(same, tmp_path, capsys):
    rom = ROM.read_bytes()
    used = struct.unpack_from("<I", rom, 0x80)[0]
    code, said, ok = check(same, tmp_path, rom, rom[:used], capsys)  # the user's copy was trimmed
    assert code == 0 and ok and "trimmed" in said
    (tmp_path / "rom.ok").unlink()
    code, said, ok = check(same, tmp_path, rom[:used], rom[:used] + b"\xff" * 0x20000, capsys)  # or padded further
    assert code == 0 and ok and "more padding" in said
    (tmp_path / "rom.ok").unlink()
    code, said, ok = check(same, tmp_path, rom, rom, capsys)
    assert code == 0 and ok and said == ""


def test_what_differs_is_named(same, tmp_path, capsys):
    rom = ROM.read_bytes()
    arm9_off, _, arm9_ram = struct.unpack_from("<III", rom, 0x20)
    changed = bytearray(rom)
    changed[arm9_off + 0x800] ^= 0xFF  # a byte of the ARM9 program
    code, said, ok = check(same, tmp_path, bytes(changed), rom, capsys)
    assert code == 1 and not ok
    assert f"the ARM9 program differs from offset 0x800 (RAM 0x{arm9_ram + 0x800:08X})" in said

    fat_off = struct.unpack_from("<I", rom, 0x48)[0]
    start, _end = struct.unpack_from("<II", rom, fat_off)
    changed = bytearray(rom)
    changed[start] ^= 0xFF  # the first file's first byte
    names = same.Rom(rom).names()
    assert same.explain(bytes(changed), rom) == [f"1 file differs: {names.get(0, 'file #0')}"]

    changed = bytearray(rom)
    changed[0x0E:0x10] = b"XX"  # the game code (the header's checksum then differs too)
    assert same.explain(bytes(changed), rom)[0].startswith("header: game code")

    gap = struct.unpack_from("<I", rom, 0x30)[0] - 0x10  # padding before the ARM7 program
    changed = bytearray(rom)
    changed[gap] ^= 0x55
    assert same.explain(bytes(changed), rom) == [f"only the padding between the parts differs (from offset {gap:#x}): "
                                                 "every program and file is the same"]
