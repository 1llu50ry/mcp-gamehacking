"""Nintendo DS from scratch: a ds-decomp project generated for the user's game, worked on like a fork.

Demo Quest DS (projects/demo-ds) is built like a DS game: CodeWarrior for DS 2.0, linked by CodeWarrior's linker with
a NitroSDK-style ARM9 (secure area, build info, autoloads to the ITCM and DTCM, static initializers). Importing it
must produce a project that rebuilds the ROM byte for byte, and agents' C must be judged by the project's own build
and objdiff. CodeWarrior is proprietary, so this runs only where `mwccarm` was installed with its license accepted.
"""

import subprocess
import sys
from pathlib import Path

import pytest
from elftools.elf.elffile import ELFFile

from decompnet import toolchains
from decompnet.app.engine import RomNetwork
from decompnet.forks import csource

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "projects" / "demo-ds"
ROM, ELF = DEMO / "build" / "demoquest.nds", DEMO / "build" / "demoq_ds.elf"
GAME = ROOT / "projects" / "demo-n64" / "original" / "game.c"

pytestmark = pytest.mark.skipif(
    any(toolchains.installed(t) is None for t in ("mwccarm", "dsd", "objdiff-cli"))
    or (toolchains.get("wibo").supported and toolchains.installed("wibo") is None),
    reason="needs CodeWarrior for DS (mwccarm, proprietary) and ds-decomp")


@pytest.fixture(scope="module")
def ds(tmp_path_factory):
    if not ROM.exists():
        subprocess.run([sys.executable, str(DEMO / "build.py")], check=True)
    work = tmp_path_factory.mktemp("ds")
    net = RomNetwork(work / "app.db", work)
    slug = net.import_rom(ROM, confirmed=True, log=lambda *_: None)
    return net, slug


def test_project_rebuilds_the_rom(ds):
    net, slug = ds
    ov = net.overview(slug)
    assert ov["kind"] == "fork" and ov["origin"] == "scratch" and ov["platform"] == "nds" and ov["ready"]
    assert ov["functions"] >= 100  # every function of the demo, found by ds-decomp
    root = Path(net.project_row(slug)["root"])
    res = subprocess.run([str(Path(sys.executable).parent / "ninja")], cwd=root, capture_output=True, text=True)
    assert res.returncode == 0, res.stdout[-2000:]
    assert (root / "build" / "adqe" / "rom.ok").exists()  # the ROM rebuilt and identical to the original
    files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True).stdout.split()
    assert files and not [f for f in files if f.startswith(("extract/", "build/"))]
    assert any(f.startswith("config/adqe/arm9/") for f in files) and any(f.startswith("src/auto/") for f in files)


def test_agents_match_functions(ds):
    net, slug = ds
    with open(ELF, "rb") as fh:
        syms = {s.name: s["st_value"] for s in ELFFile(fh).get_section_by_name(".symtab").iter_symbols()}
    agent, _ = net.local_agent("ds-agent")
    source = GAME.read_text()
    # what an agent does first: the game's types into the shared header, and the player under ds-decomp's name
    player = f"data_{syms['g_player']:08x}"
    types = "\n".join(ln for ln in (GAME.parent / "game.h").read_text().splitlines()
                      if not ln.startswith(("#include", "typedef signed", "typedef unsigned", "typedef float", "#define NULL")))
    types = types.replace("extern Player g_player;", f"extern Player {player};")
    assert net.forks.edit_file(agent, slug, "include/common.h", "", types, "the game's types").startswith("✅")
    for name in ("clamp_s32", "abs_s32", "player_take_damage"):
        auto = f"func_{syms[name]:08x}"
        code = csource.get(source, name).replace(name + "(", auto + "(", 1).replace("g_player", player)
        res = net.attempt(agent, auto, code, slug)
        assert res["matched"], res["text"]
    other = f"func_{syms['rng_next']:08x}"
    wrong = net.attempt(agent, other, f"int {other}(void) {{ return 4; }}", slug)
    assert not wrong["matched"]
    net.release(agent, other, "", slug)
    root = Path(net.project_row(slug)["root"])
    assert "Match func_" in subprocess.run(["git", "log", "--oneline"], cwd=root, capture_output=True, text=True).stdout


def test_autopilot_tries_machine_drafts(ds):
    """The DS project's own build and objdiff judge every function's ARM draft before any agent."""
    net, slug = ds
    if toolchains.installed("m2c") is None:
        pytest.skip("needs m2c")
    proj = net.project_row(slug)
    root = Path(proj["root"])
    agent, _ = net.local_agent("autopilot")
    outcomes = [net.forks.autopilot_one(agent, proj, fid) for fid in net.forks.autopilot_prepare(slug)[:20]]
    print(outcomes)
    assert "match" in outcomes
    assert subprocess.run(["git", "status", "--porcelain", "src"], cwd=root, capture_output=True, text=True).stdout == ""


def test_a_trimmed_copy_imports(tmp_path):
    """Issue #6: most DS dumps in the wild are trimmed (the cartridge's unused end cut off). ds-decomp rebuilds the
    full cartridge, which differed from such a copy, and the import stopped. Now it's the same game; and a ROM that
    really doesn't come out identical yet only gets a note, since agents compare each function with the copy's code."""
    import struct

    rom = ROM.read_bytes()
    trimmed = tmp_path / "trimmed.nds"
    trimmed.write_bytes(rom[:struct.unpack_from("<I", rom, 0x80)[0]])
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    slug = net.import_rom(trimmed, confirmed=True, log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["ready"] and ov["functions"] >= 100
    assert ov["rebuild"]["identical"] and "trimmed" in ov["rebuild"]["detail"]
    root = Path(net.project_row(slug)["root"])
    assert subprocess.run([str(Path(sys.executable).parent / "ninja")], cwd=root, capture_output=True).returncode == 0

    gap = struct.unpack_from("<I", rom, 0x30)[0] - 0x10  # garbage in the padding before the ARM7 program
    odd = bytearray(rom)
    odd[gap] ^= 0x55
    (tmp_path / "odd.nds").write_bytes(bytes(odd))
    slug = net.import_rom(tmp_path / "odd.nds", confirmed=True, log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["ready"] and not ov["rebuild"]["identical"] and "padding" in ov["rebuild"]["detail"]
    assert net.forks.check_rom(slug, log=lambda *_: None)["identical"] is False
