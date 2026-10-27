"""The demo game rebuilt with real period compilers. Skipped when a toolchain isn't installed
(`decompnet toolchain install gcc-2.7.2-kmc ee-gcc-2.96 m2c`)."""

from pathlib import Path

import pytest

from decompnet import seeds, toolchains
from decompnet.elfobj import extract_function
from decompnet.network import Network
from decompnet.project import import_project

from .solutions import SOLUTIONS, WRONG_CLAMP

PROJECTS = Path(__file__).resolve().parent.parent / "projects"
CASES = [("demo-n64", "gcc-2.7.2-kmc", True), ("demo-ps2", "ee-gcc-2.96", False)]


@pytest.mark.parametrize("slug,toolchain,big_endian", CASES)
def test_known_solutions_match_on_period_compilers(tmp_path, slug, toolchain, big_endian):
    if toolchains.installed(toolchain) is None:
        pytest.skip(f"{toolchain} not installed")
    net = Network(tmp_path / "p.db")
    import_project(net.store, PROJECTS / slug, log=lambda *_: None)
    agent = net.authenticate(net.register_agent("t"))
    assert net.compile_and_diff(agent, "clamp_s32", WRONG_CLAMP, project=slug).startswith("score ")
    for name, src in sorted(SOLUTIONS.items(), key=lambda kv: kv[0] != "clamp_s32"):  # finish the held claim first
        assert "MATCH" in net.compile_and_diff(agent, name, src, project=slug), f"{slug}/{name}"
    fn = extract_function((PROJECTS / slug / "target" / "game.o").read_bytes(), "game_tick")
    assert fn.arch == "mips" and fn.big_endian == big_endian
    assert {"entity_update_physics", "add_score"} <= {r.symbol for r in fn.relocs}  # calls resolved by name


def test_m2c_drafts_a_starting_point():
    if toolchains.installed("gcc-2.7.2-kmc") is None or not seeds.available():
        pytest.skip("gcc-2.7.2-kmc or m2c not installed")
    fn = extract_function((PROJECTS / "demo-n64" / "target" / "game.o").read_bytes(), "player_take_damage")
    assert "glabel player_take_damage" in seeds.gnu_asm(fn) and "%hi(g_player+0x20)" in seeds.gnu_asm(fn)
    draft = seeds.generate(fn, "gcc-2.7.2-kmc", (PROJECTS / "demo-n64" / "include" / "context.h").read_text())
    assert draft and "void player_take_damage" in draft and "g_player.unk_1C" in draft
