"""The local engine on Demo Quest 64: import, claim, split, match, rename, read data, export."""

import shutil
from pathlib import Path

import pytest

from decompnet import toolchains
from decompnet.app.engine import RomNetwork
from decompnet.network import NetworkError

from .test_rom import built  # noqa: F401  (fixture that builds the demo ROM)

pytestmark = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-kmc and ld.lld to build the demo ROM")

CLAMP = """s32 func_800007D0(s32 v, s32 lo, s32 hi) {
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}"""

DAMAGE = """typedef struct {
    u8 ent[0x1C];
    s32 hp;
    s16 invuln_timer;
    s16 state;
    s32 combo;
} Player;
extern Player D_8004AE34;

void func_80000808(s32 amount) {
    if (D_8004AE34.invuln_timer > 0) {
        return;
    }
    D_8004AE34.hp -= amount;
    if (D_8004AE34.hp <= 0) {
        D_8004AE34.hp = 0;
        D_8004AE34.state = 3;
    }
    D_8004AE34.invuln_timer = 60;
}"""


@pytest.fixture(scope="module")
def net(built, tmp_path_factory):  # noqa: F811
    ws = tmp_path_factory.mktemp("ws")
    net = RomNetwork(ws / "decomp.db", ws)
    slug = net.import_rom(built, confirmed=True, log=lambda *_: None)
    assert slug == "demo-quest-64"
    return net


def test_import_needs_the_ownership_confirmation(built, tmp_path):  # noqa: F811
    with pytest.raises(NetworkError, match="legally obtained"):
        RomNetwork(tmp_path / "d.db", tmp_path).import_rom(built, log=lambda *_: None)


def test_import_is_idempotent_and_described(net, built):  # noqa: F811
    assert net.import_rom(built, confirmed=True, log=lambda *_: None) == "demo-quest-64"
    ov = net.overview("demo-quest-64")
    assert ov["functions"] >= 95 and ov["matched"] == 0 and ov["compiler"]["toolchain"] == "gcc-2.7.2-kmc"
    assert ov["rom"]["game_code"] == "NDQE"


def test_split_match_and_rename(net):
    agent, _ = net.local_agent("tester")
    # exit() never returns, so the disassembler ran it into clamp_s32: split them, then match clamp_s32
    assert "split" in net.split_function(agent, "demo-quest-64", "func_800007C4", "0x800007D0")
    brief = net.claim(agent, "demo-quest-64", "func_800007D0")
    assert "0x800007D0" in brief and "slt " in brief and "m2c" in brief
    out = net.compile_and_diff(agent, "func_800007D0", CLAMP, "demo-quest-64")
    assert out.startswith("✅ MATCH"), out
    out = net.rename_symbol(agent, "demo-quest-64", "func_800007D0", "clamp_s32")
    assert out.startswith("✅"), out
    assert net._function("clamp_s32", "demo-quest-64")["status"] == "matched"
    assert "clamp_s32" in net._function("clamp_s32", "demo-quest-64")["matched_source"]


def test_struct_access_through_an_automatic_name(net):
    agent, _ = net.local_agent("tester2")
    brief = net.get_function("func_80000808", "demo-quest-64")
    assert "D_8004AE50" in brief  # g_player.hp, as the assembly names it
    out = net.compile_and_diff(agent, "func_80000808", DAMAGE, "demo-quest-64")
    assert out.startswith("✅ MATCH"), out
    # renaming the struct's address keeps the match (the source is updated with it)
    assert net.rename_symbol(agent, "demo-quest-64", "D_8004AE34", "g_player").startswith("✅")
    assert "g_player.hp" in net._function("func_80000808", "demo-quest-64")["matched_source"]


def test_wrong_code_gets_a_diff_and_link_notes(net):
    agent, _ = net.local_agent("tester3")
    out = net.compile_and_diff(agent, "func_80000A0C", "void func_80000A0C(s32 p) { mystery(p); }", "demo-quest-64")
    assert "score" in out and "mystery" in out
    # the GUI's diff: the same judge, row by row, with the link problems
    d = net.function_diff("demo-quest-64", "func_80000A0C")
    assert d["kind"] == "latest" and d["score"] > 0 and any(r[0] != " " for r in d["rows"])
    assert any("mystery" in p for p in d["problems"])
    assert net.function_diff("demo-quest-64", "func_80000A0C") == d  # cached
    net.compile_and_diff(agent, "func_80000A0C", "void func_80000A0C(s32 p) { p = }", "demo-quest-64")
    broken = net.function_diff("demo-quest-64", "func_80000A0C")
    assert broken["rows"] is None and broken["error"]
    assert net.function_diff("demo-quest-64", "func_80000A0C", "best")["score"] == d["score"]
    assert net.function_diff("demo-quest-64", "func_80000B3C")["rows"] is None  # nothing tried yet
    net.release(agent, "func_80000A0C", "not this", "demo-quest-64")


def test_read_data_and_lists(net):
    text = net.read_data("demo-quest-64", "0x800082C0", 16)
    assert "DEMOQUEST-SAVE" in text
    assert "bss" in net.read_data("demo-quest-64", "g_player", 16)
    assert "clamp_s32" in net.list_functions("demo-quest-64", "matched")


def test_export_and_live(net):
    out = net.export_rom("demo-quest-64", log=lambda *_: None)
    assert out["identical"], out["log"]
    assert "clamp_s32" in (Path(out["path"]) / "src" / "main" / "clamp_s32.c").read_text()
    live = net.live("demo-quest-64")
    assert live["overview"]["matched"] >= 2 and any(e["kind"] == "match" for e in live["events"])
    fmap = net.function_map("demo-quest-64")
    assert sum(f["status"] == "matched" for f in fmap) >= 2
    detail = net.function_detail("demo-quest-64", "clamp_s32")
    assert detail["status"] == "matched" and detail["scores"]
    d = net.function_diff("demo-quest-64", "clamp_s32")
    assert d["kind"] == "matched" and d["score"] == 0 and all(r[0] == " " for r in d["rows"])
    assert any(f["matched_at"] for f in fmap) and all("unit" in f for f in fmap)
    assert net.overview("demo-quest-64")["last_activity"]


def test_find_similar_on_the_rom(net):
    import time

    t = time.time()
    names = [r["name"] for r in net.store.all("SELECT name FROM functions WHERE n_insns > 12 LIMIT 40")]
    outs = [net.find_similar("demo-quest-64", n) for n in names]
    assert time.time() - t < 20
    assert all(o.startswith(("Functions that look like", "No look-alikes")) for o in outs)


def test_autopilot_matches_machine_drafts_for_free(net):
    import time

    before = net.overview("demo-quest-64")["matched"]
    net.start_autopilot("demo-quest-64")
    for _ in range(600):
        if net.autopilot_status("demo-quest-64")["state"] != "running":
            break
        time.sleep(0.1)
    st = net.autopilot_status("demo-quest-64")
    assert st["state"] == "done" and st["done"] == st["total"] and st["matched"] > 0
    assert st["tried"] == st["done"] - st["cached"] - st["skipped"]  # only what was made and judged
    ov = net.overview("demo-quest-64")
    assert ov["matched"] == before + st["matched"] and ov["autopilot"]["matched"] == st["matched"]
    assert ov["autopilot"]["done"] == st["done"] and "reasons" in ov["autopilot"]
    by = net.store.one("SELECT COUNT(*) AS n FROM functions f JOIN agents a ON a.id=f.matched_agent_id "
                       "WHERE a.name='autopilot'")["n"]
    assert by == st["matched"]
    assert not net.store.one("SELECT 1 FROM claims c JOIN agents a ON a.id=c.agent_id WHERE a.name='autopilot'")


def test_autopilot_leaves_unchanged_drafts_alone(net, monkeypatch):
    """Running it again used to re-draft and recompile every open function, even though neither the headers nor the
    compiler had changed since the same draft got the same verdict. A context edit is what makes them worth it."""
    import time

    from decompnet import seeds

    def run() -> dict:
        net.start_autopilot("demo-quest-64")
        for _ in range(900):
            st = net.autopilot_status("demo-quest-64")
            if st["state"] != "running":
                return st
            time.sleep(0.1)
        raise AssertionError("autopilot didn't finish")

    first = run()
    assert first["done"] == first["total"] and first["tried"] + first["cached"] + first["skipped"] == first["done"]
    drafts = []
    make = seeds.generate_from_asm
    monkeypatch.setattr(seeds, "generate_from_asm", lambda *a, **k: drafts.append(a) or make(*a, **k))
    second = run()
    assert second["done"] == second["total"] and second["tried"] == 0 and second["cached"] == second["done"]
    assert drafts == [], "a draft nothing changed for was made again"
    proj = net.project_row("demo-quest-64")
    with net.store.tx() as db:  # a header edit (a new context version) is what makes drafts worth trying again
        version = db.execute("SELECT MAX(version) AS v FROM context_versions WHERE project_id=?", (proj["id"],)).fetchone()["v"]
        db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                   "SELECT project_id, ?, header, NULL, 'test edit', ?, '' FROM context_versions "
                   "WHERE project_id=? AND unit='' ORDER BY version DESC LIMIT 1", (version + 1, time.time(), proj["id"]))
    third = run()
    assert third["tried"] > 0 and drafts, "a new context version left the drafts untried"


def test_steering_priority_instructions_spend(net):
    slug = "demo-quest-64"
    open_fn = net.store.one("SELECT name FROM functions WHERE status='open' ORDER BY n_insns DESC LIMIT 1")["name"]
    assert net.set_priority(slug, open_fn) == [open_fn]
    agent, _ = net.local_agent("steered")
    assert open_fn in net.claim(agent, slug)  # the user's pick comes first, whatever the strategy
    net.release(agent, open_fn, "testing priorities", slug)
    net.set_priority(slug, open_fn, on=False)
    net.set_instructions(slug, "Focus on the game's own code first.")
    from decompnet.app import tools
    assert "Focus on the game's own code first." in tools.project_info(net, slug)
    net.add_spend(slug, 0.25, 0)
    net.add_spend(slug, 0.5, 1200)
    sp = net.overview(slug)["spend"]
    assert round(sp["usd"], 2) == 0.75 and sp["tokens"] == 1200


def test_stats_say_who_matched_what_and_how_fast(net):
    st = net.stats("demo-quest-64")
    assert len(st["matches_per_hour"]) == 24
    agent, _ = net.local_agent("statsy")
    net.compile_and_diff(agent, "func_80000A0C", "void func_80000A0C(s32 p) { }", "demo-quest-64")
    st = net.stats("demo-quest-64")
    me = next(r for r in st["agents"] if r["agent"] == "statsy")
    assert me["compiles"] == 1 and st["compiles_last_hour"] >= 1
    assert all("matched_by" in r for r in net.function_map("demo-quest-64"))


def test_symbol_addrs_import_renames_a_rom_function(built, tmp_path):  # noqa: F811
    net = RomNetwork(tmp_path / "symbols.db", tmp_path)
    slug = net.import_rom(built, confirmed=True, log=lambda *_: None)
    path = tmp_path / "symbol_addrs.txt"
    path.write_text("clamp_s32 = 0x800007D0; // type:func size:0x24\n")
    result = net.import_debug_info(slug, str(path))
    # exit() never returns, so the split ran exit into clamp_s32: the symbol file's address is the real boundary,
    # so importing it splits the merged function instead of dropping the name.
    assert result["renamed"] == 1 and result["split"] == 1 and not result["warning"]
    assert net._function("clamp_s32", slug)["vram"] == 0x800007D0
    exported = net.export_debug_info(slug)
    assert "clamp_s32 = 0x800007D0;" in Path(exported["symbol_addrs"]).read_text()
