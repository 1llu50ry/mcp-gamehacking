"""PlayStation ROM projects: split a homemade PS-X EXE and prove the matcher on it.

Demo Quest PS1 (projects/demo-psx) is the Demo Quest game built for the PlayStation with GCC 2.7.2 at -O2 -G8,
little-endian, small globals $gp-relative, like PSY-Q-era games. The executable carries no symbols, so the test
does what an agent does: give addresses names, declare the game's types, then write each function. Every one of
them must match byte for byte.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from elftools.elf.elffile import ELFFile

from decompnet import toolchains
from decompnet.app.engine import RomNetwork
from decompnet.forks import csource

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "projects" / "demo-psx"
EXE = DEMO / "build" / "DEMOQ_PS1.EXE"
ELF = DEMO / "build" / "demoq_ps1.elf"
GAME = ROOT / "projects" / "demo-n64" / "original"
FUNCTIONS = ["clamp_s32", "abs_s32", "player_take_damage", "rng_next", "count_alive_entities", "entity_update_physics",
             "entity_default_hp", "entity_spawn", "add_score", "lerp", "checksum_save", "entity_collides", "game_tick"]

pytestmark = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-psx") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-psx and ld.lld to build the PS1 demo")


@pytest.fixture(scope="module")
def psx(tmp_path_factory):
    if not EXE.exists():
        subprocess.run([sys.executable, str(DEMO / "build.py")], check=True)
    work = tmp_path_factory.mktemp("psx")
    net = RomNetwork(work / "app.db", work)
    slug = net.import_rom(EXE.read_bytes(), confirmed=True, log=lambda *_: None)
    return net, slug


def test_import(psx):
    net, slug = psx
    ov = net.overview(slug)
    assert ov["platform"] == "psx" and ov["compiler"]["toolchain"] == "gcc-2.7.2-psx" and ov["functions"] > 60
    assert "WITHOUT" in net.get_context(slug)  # the gp-relative globals advice


def test_every_game_function_matches(psx):
    net, slug = psx
    agent, _ = net.local_agent("psx-agent")
    with open(ELF, "rb") as fh:
        syms = {s.name: s["st_value"] for s in ELFFile(fh).get_section_by_name(".symtab").iter_symbols()}
    header = (GAME / "game.h").read_text()
    header = "\n".join(ln for ln in header.splitlines()
                       if not ln.startswith("#include") and not re.match(r"typedef \w+( \w+)? [su]\d+;|typedef \w+ f\d+;", ln))
    header = re.sub(r"^extern (s32|u32) (g_\w+);", r"\1 \2;", header, flags=re.MULTILINE)  # small globals: no extern
    assert net.edit_context(agent, slug, "", header, "the game's types").startswith("✅")
    table = net.symbols(net.project_row(slug)["id"])
    for name in [*FUNCTIONS, "g_player", "g_entities", "g_score", "g_frame_count", "g_rng_state",
                 "__subsf3", "__mulsf3", "__addsf3", "__divsf3", "__ltsf2", "__gtsf2", "__fixsfsi",
                 "__floatsisf"]:
        if name in syms:
            current, offset = table.name_at(syms[name])
            if offset:  # inside a bigger data symbol (adjacent globals): name the address itself
                current = f"D_{syms[name]:08X}"
            if current != name:
                net.rename_symbol(agent, slug, current, name)
                table = net.symbols(net.project_row(slug)["id"])
    source = (GAME / "game.c").read_text()
    scores = {name: net.attempt(agent, name, csource.get(source, name), slug)["score"] for name in FUNCTIONS}
    assert all(score == 0 for score in scores.values()), scores


def test_wrong_code_does_not_match(psx):
    net, slug = psx
    agent, _ = net.local_agent("psx-agent-2")
    fn = net.store.one("SELECT name FROM functions WHERE status='open' AND n_insns > 8 ORDER BY n_insns LIMIT 1")
    res = net.attempt(agent, fn["name"], f"int {fn['name']}(int a) {{ return a * 3; }}", slug)
    assert not res["matched"]
    net.release(agent, fn["name"], "", slug)
