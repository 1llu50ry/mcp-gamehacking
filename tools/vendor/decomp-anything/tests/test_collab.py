"""Rooms: a host and a guest, each with their own copy of Demo Quest 64, working together."""

import json
import re
import shutil
import time

import pytest
from starlette.testclient import TestClient

from decompnet import toolchains
from decompnet.app import collab
from decompnet.app.engine import RomNetwork
from decompnet.network import NetworkError

from .test_app_engine import CLAMP, DAMAGE
from .test_rom import built  # noqa: F401

pytestmark = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-kmc")


@pytest.fixture(scope="module")
def room(built, tmp_path_factory):  # noqa: F811
    h = tmp_path_factory.mktemp("host")
    host = RomNetwork(h / "d.db", h)
    slug = host.import_rom(built, confirmed=True, log=lambda *_: None)
    host.rooms[slug] = collab.Room(host, slug)
    code = host.rooms[slug].open_invite()
    client = TestClient(collab.host_app(host, host.rooms), base_url="https://abc.trycloudflare.com")
    g = tmp_path_factory.mktemp("guest")
    guest = RomNetwork(g / "d.db", g)
    link = f"https://abc.trycloudflare.com/join/{code}#room={slug}"
    gslug = collab.join_room(guest, link, "alex", built, log=lambda *_: None, client=client, start=False)
    return host, slug, guest, gslug, client, code, link


def test_parse_invite():
    assert collab.parse_invite("https://x-y.trycloudflare.com/join/abcdefghij#room=demo") == (
        "https://x-y.trycloudflare.com", "abcdefghij#demo")
    with pytest.raises(NetworkError):
        collab.parse_invite("https://example.com/whatever")


def test_joining_needs_the_same_rom_and_a_valid_invite(room, built, tmp_path):  # noqa: F811
    host, slug, _guest, _gslug, client, code, link = room
    other = RomNetwork(tmp_path / "o.db", tmp_path)
    changed = bytearray(built)
    changed[0x2000] ^= 0xFF
    with pytest.raises(NetworkError, match="same as the host"):
        collab.join_room(other, link, "eve", bytes(changed), log=lambda *_: None, client=client, start=False)
    with pytest.raises(NetworkError, match="no longer valid"):
        collab.join_room(other, link.replace(code, "x" * 22), "eve", built, log=lambda *_: None, client=client, start=False)
    assert [m["name"] for m in host.rooms[slug].members()] == ["alex"]


def test_state_carries_work_never_rom_data(room):
    _host, slug, guest, gslug, client, _code, _link = room
    tok = guest.links[gslug].token
    st = client.get(f"/collab/state?room={slug}", headers={"authorization": f"Bearer {tok}"}).json()
    text = json.dumps(st)
    assert "glabel" not in text and "target" not in st
    assert not re.search(r"/\* [0-9A-F]+ [0-9A-F]{8} [0-9A-F]{8} \*/", text)  # no disassembly lines
    assert st["functions"] and st["members"][0]["name"] == "alex"
    assert client.get(f"/collab/state?room={slug}", headers={"authorization": "Bearer dn_nope"}).status_code == 400
    # a member that is up to date gets no layout at all; one whose cursor is unreadable gets the whole split
    current = client.get(f"/collab/state?room={slug}&l=1e12", headers={"authorization": f"Bearer {tok}"}).json()
    assert "functions" not in current and "symbols" not in current and current["l"] > 0
    assert client.get(f"/collab/state?room={slug}&l=soon", headers={"authorization": f"Bearer {tok}"}).json()["functions"]


def test_split_and_match_from_the_guest_reach_the_host(room):
    host, slug, guest, gslug, _client, _code, _link = room
    agent, _ = guest.local_agent("claude-1")
    assert guest.split_function(agent, gslug, "func_800007C4", "0x800007D0").startswith("✅")
    assert host._function("func_800007D0", slug)  # split on the host...
    assert guest._function("func_800007D0", gslug)  # ...and mirrored locally
    brief = guest.claim(agent, gslug, "func_800007D0")
    assert "glabel func_800007D0" in brief  # the guest's own copy provides the assembly
    claims = host.live(slug)["claims"]
    assert claims and claims[0]["agent"] == "alex.claude-1"
    out = guest.compile_and_diff(agent, "func_800007D0", CLAMP, gslug)
    assert out.startswith("✅ MATCH") and "host confirmed" in out
    assert host._function("func_800007D0", slug)["status"] == "matched"


def test_host_work_reaches_the_guest(room):
    host, slug, guest, gslug, _client, _code, _link = room
    hagent, _ = host.local_agent("codex-1")
    assert host.compile_and_diff(hagent, "func_80000808", DAMAGE, slug).startswith("✅ MATCH")
    assert host.rename_symbol(hagent, slug, "func_800007D0", "clamp_s32").startswith("✅")
    assert host.edit_context(hagent, slug, "", "s32 clamp_s32(s32 v, s32 lo, s32 hi);", "prototype").startswith("✅")
    guest.links[gslug].sync()
    assert guest._function("func_80000808", gslug)["status"] == "matched"
    assert guest._function("clamp_s32", gslug)["status"] == "matched"
    assert "clamp_s32(s32 v" in guest.get_context(gslug)
    feed = [e["kind"] for e in guest.live(gslug)["events"]]
    assert "match" in feed
    assert guest.overview(gslug)["room"]["role"] == "guest"


def test_guest_edits_go_through_the_host(room):
    host, slug, guest, gslug, _client, _code, _link = room
    agent, _ = guest.local_agent("claude-2")
    out = guest.rename_symbol(agent, gslug, "func_80000808", "player_take_damage")
    assert out.startswith("✅")
    assert host._function("player_take_damage", slug)["status"] == "matched"
    assert guest._function("player_take_damage", gslug)
    guest.add_note(agent, gslug, "player struct is at 0x8004AE34")
    assert "0x8004AE34" in host.search_notes(slug, "player struct")


ABS = "s32 func_800007F4(s32 v) { return v < 0 ? -v : v; }"


def test_two_friends_work_together(room, built, tmp_path):  # noqa: F811
    host, slug, guest, gslug, client, _code, link = room
    bea = RomNetwork(tmp_path / "bea.db", tmp_path)
    bslug = collab.join_room(bea, link, "bea", built, log=lambda *_: None, client=client, start=False)
    assert sorted(m["name"] for m in host.rooms[slug].members()) == ["alex", "bea"]
    a_agent, _ = guest.local_agent("codex-1")
    b_agent, _ = bea.local_agent("claude-1")
    guest.claim(a_agent, gslug)
    bea.claim(b_agent, bslug)
    claims = {c["agent"]: c["name"] for c in host.live(slug)["claims"]}
    assert claims["alex.codex-1"] != claims["bea.claude-1"]  # the host never hands out the same function twice
    guest.release(a_agent, claims["alex.codex-1"], "", gslug)
    out = guest.compile_and_diff(a_agent, "func_800007F4", ABS, gslug)
    assert out.startswith("✅ MATCH"), out
    bea.links[bslug].sync()
    assert bea._function("func_800007F4", bslug)["status"] == "matched"  # bea sees alex's match


def test_reconnect_after_the_host_restarts(room, built):  # noqa: F811
    host, slug, guest, gslug, _client, _code, _link = room
    host.rooms[slug].close()  # the host quits: the tunnel and its address are gone
    new_code = host.rooms[slug].open_invite()  # ...and shares again from a new address
    new_client = TestClient(collab.host_app(host, host.rooms), base_url="https://new-address.trycloudflare.com")
    new_link = f"https://new-address.trycloudflare.com/join/{new_code}#room={slug}"
    before = sorted(m["name"] for m in host.rooms[slug].members())
    again = collab.join_room(guest, new_link, "alex", b"", log=lambda *_: None, client=new_client, start=False)
    assert again == gslug
    assert sorted(m["name"] for m in host.rooms[slug].members()) == before  # same member, not "alex2"
    link_obj = guest.links[gslug]
    assert link_obj.url == "https://new-address.trycloudflare.com" and link_obj.member == "alex"
    link_obj.sync()
    agent, _ = guest.local_agent("claude-9")
    assert "CLAIMED" in guest.claim(agent, gslug)


def test_closing_the_room_locks_guests_out(room):
    host, slug, _guest, _gslug, client, _code, link = room
    host.rooms[slug].close()
    with pytest.raises(NetworkError):
        collab.join_room(RomNetwork(":memory:", __import__("pathlib").Path("/tmp")), link, "late", b"", client=client, start=False)


def _host(built, tmp_path, **settings):  # noqa: F811
    host = RomNetwork(tmp_path / "h.db", tmp_path / "h")
    slug = host.import_rom(built, confirmed=True, log=lambda *_: None)
    room = collab.Room(host, slug)
    room.configure(**settings)
    host.rooms[slug] = room
    code = room.open_invite()
    client = TestClient(collab.host_app(host, host.rooms), base_url="http://192.168.1.20:6481")
    return host, slug, room, code, client


def _guest(tmp_path, name, link, built, client):  # noqa: F811
    g = RomNetwork(tmp_path / f"{name}.db", tmp_path / name)
    return g, collab.join_room(g, link, name, built, log=lambda *_: None, client=client, start=False)


def test_public_rooms_need_no_invite_code(built, tmp_path):  # noqa: F811
    _, slug, room, _code, client = _host(built, tmp_path, visibility="public")
    _g, _gslug = _guest(tmp_path, "pub", f"http://192.168.1.20:6481/join/open#room={slug}", built, client)
    assert [m["name"] for m in room.members()] == ["pub"]
    room.configure(visibility="private")  # back to private: the bare address isn't enough any more
    with pytest.raises(NetworkError, match="no longer valid"):
        _guest(tmp_path, "late", f"http://192.168.1.20:6481/join/open#room={slug}", built, client)


def test_the_host_lets_people_in_and_can_take_them_out(built, tmp_path):  # noqa: F811
    _, slug, room, code, client = _host(built, tmp_path, approve=True)
    link = f"http://192.168.1.20:6481/join/{code}#room={slug}"
    g, gslug = _guest(tmp_path, "kim", link, built, client)
    assert [p["name"] for p in room.pending()] == ["kim"] and room.members() == []
    with pytest.raises(NetworkError, match="waiting for the host"):
        g.links[gslug].sync()
    room.approve("kim")
    g.links[gslug].sync()
    assert [m["name"] for m in room.members()] == ["kim"]
    room.remove("kim")
    with pytest.raises(NetworkError):
        g.links[gslug].sync()
    assert room.members() == []


def test_better_attempts_reach_the_host_without_a_compile_there(built, tmp_path):  # noqa: F811
    host, slug, _room, code, client = _host(built, tmp_path)
    g, gslug = _guest(tmp_path, "lee", f"http://192.168.1.20:6481/join/{code}#room={slug}", built, client)
    agent, _ = g.local_agent("claude-1")
    g.claim(agent, gslug, "func_800007F4")
    res = g.attempt(agent, "func_800007F4", "s32 func_800007F4(s32 v) { return v + 1; }", gslug)
    assert res["score"] and not res["matched"]
    for _ in range(50):  # reported from a background thread
        row = host.store.one("SELECT best_score, best_source FROM functions WHERE name='func_800007F4'")
        if row["best_score"] is not None:
            break
        __import__("time").sleep(0.1)
    assert row["best_score"] == res["score"] and "v + 1" in row["best_source"]
    assert host.store.one("SELECT via FROM attempts ORDER BY id DESC LIMIT 1")["via"] == "room"


def test_a_crowd_in_one_room(built, tmp_path):  # noqa: F811
    _, slug, room, _code, client = _host(built, tmp_path, visibility="public")
    link = f"http://192.168.1.20:6481/join/open#room={slug}"
    guests = [_guest(tmp_path, f"m{i}", link, built, client) for i in range(12)]
    agents = [g.local_agent("claude-1")[0] for g, _ in guests]
    claimed = [g.claim(a, s).splitlines()[0] for (g, s), a in zip(guests, agents, strict=False)]
    assert len(set(claimed)) == len(claimed)  # never the same function twice
    members = room._members_now()  # members() is cached for a few seconds: everyone polls it
    assert len(members) == 12 and all(m["working"] for m in members)


def test_members_stay_in_the_room_when_their_app_restarts(built, tmp_path):  # noqa: F811
    _, slug, room, code, client = _host(built, tmp_path)
    _g, gslug = _guest(tmp_path, "sam", f"http://192.168.1.20:6481/join/{code}#room={slug}", built, client)
    again = RomNetwork(tmp_path / "sam.db", tmp_path / "sam")  # the member's app starts again
    again.restore_links()
    assert gslug in again.links and again.links[gslug].member == "sam"
    again.links[gslug].client = client
    again.links[gslug].stop()
    again.links[gslug].sync()
    assert [m["name"] for m in room._members_now()] == ["sam"]


def test_the_host_cannot_join_its_own_room(built, tmp_path):  # noqa: F811
    """A host testing the invite with its own copy must not turn its project into a guest of itself."""
    host, slug, _room, code, client = _host(built, tmp_path)
    link = f"http://192.168.1.20:6481/join/{code}#room={slug}"
    with pytest.raises(NetworkError, match="hosting a room for this game"):
        collab.join_room(host, link, "hosty", built, client=client, log=lambda *_: None, start=False)
    assert slug not in host.links and host.overview(slug)["room"]["role"] == "host"
    assert host.rooms[slug].members() == []  # nobody was added for the refused join


def test_a_big_room_layout_applies_without_scanning_every_function(tmp_path):
    """A first sync carries every function and symbol: 8,000 boundaries the guest has no function for must not cost
    a scan of all 20,000 local functions each (that stall is what showed a live room as offline)."""
    net = RomNetwork(tmp_path / "big.db", tmp_path)
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) "
                         "VALUES(?,?,?,?,?,?,?)", ("big", "Big", "", "mips", 1, str(tmp_path / "big"),
                                                   json.dumps({"kind": "rom", "platform": "n64",
                                                               "rom": {"file": "game.z64", "title": "Game"},
                                                               "compiler": {"toolchain": "gcc-2.7.2-kmc", "flags": []}}))).lastrowid
        (tmp_path / "big").mkdir()
        db.executemany("INSERT INTO functions(project_id,name,size,n_insns,unit,vram,status) VALUES(?,?,?,?,?,?,?)",
                       [(pid, f"func_{i}", 0x10, 1, "", i * 0x20, "open") for i in range(20000)])
        db.executemany("INSERT INTO symbols(project_id,name,address,size,kind) VALUES(?,?,?,?,?)",
                       [(pid, f"func_{i}", i * 0x20, 0x10, "func") for i in range(20000)])
        db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                   "VALUES(?,?,?,?,?,?,?)", (pid, 1, "// context\n", None, "import", time.time(), ""))
    host_functions = [{"name": f"func_{i}", "vram": i * 0x20, "size": 0x10} for i in range(20000)]
    host_functions += [{"name": f"label_{i}", "vram": i * 0x20 + 0x10, "size": 0} for i in range(8000)]
    host_symbols = [{"name": (f"renamed_{i}" if i % 10 == 0 else f"func_{i}"), "address": i * 0x20,
                     "size": 0x10, "kind": "func"} for i in range(20000)]
    with net.store.tx() as db:
        for i in range(0, 20000, 200):
            db.execute("UPDATE functions SET status='matched', matched_source=? WHERE project_id=? AND vram=?",
                       (f"void func_{i}(void) {{ return func_{i + 10}(); }}", pid, i * 0x20))

    started = time.perf_counter()
    net.apply_remote_layout("big", host_functions, host_symbols)
    elapsed = time.perf_counter() - started

    assert elapsed < 10, f"layout apply took {elapsed:.1f}s"
    assert net.store.one("SELECT name FROM functions WHERE project_id=? AND vram=?", pid, 1000 * 0x20)["name"] == "renamed_1000"
    assert net.store.one("SELECT name FROM symbols WHERE project_id=? AND address=?", pid, 1000 * 0x20)["name"] == "renamed_1000"
    source = net.store.one("SELECT matched_source FROM functions WHERE project_id=? AND vram=?", pid, 1000 * 0x20)["matched_source"]
    assert "renamed_1000" in source and "renamed_1010" in source  # findings read the room's names
    assert net.symbols(pid).by_addr[1000 * 0x20].name == "renamed_1000"  # the cached table was rebuilt


def _guest_with_demo(tmp_path, rom, name: str = "guest"):
    net = RomNetwork(tmp_path / f"{name}.db", tmp_path / name)
    slug = net.import_rom(rom, confirmed=True, log=lambda *_: None)
    return net, slug, net.project_row(slug)["id"]


def test_a_room_sends_only_the_layout_that_changed(built, tmp_path):  # noqa: F811
    """A member's first sync carries the whole split; after that a rename sends the one row it changed, not every
    function and symbol of the room (17 MB for one new name in a 70,000-function room)."""
    host, slug, pid = _guest_with_demo(tmp_path, built, "host")
    room = collab.Room(host, slug)
    member = host.local_agent("alex")[0]
    first = room.state(0, 0, 0, member)
    total = host.store.one("SELECT COUNT(*) AS n FROM functions WHERE project_id=?", pid)["n"]
    assert len(first["functions"]) == total and first["symbols"] and first["l"] > 0

    fn = host.store.one("SELECT name,vram FROM functions WHERE project_id=? AND vram IS NOT NULL AND status='open' "
                        "ORDER BY vram LIMIT 1", pid)
    agent, _ = host.local_agent("codex-1")
    assert host.rename_symbol(agent, slug, fn["name"], "renamed_by_the_room").startswith("✅")

    later = room.state(first["e"], first["a"], 0, member, first["l"])
    # the one function and the one name that changed, not all of them
    assert [(f["name"], f["vram"]) for f in later["functions"]] == [("renamed_by_the_room", fn["vram"])]
    assert [s["name"] for s in later["symbols"]] == ["renamed_by_the_room"]
    assert later["l"] > first["l"]

    # a member that hasn't synced before (or came from a build without cursors) still gets everything
    again = room.state(later["e"], later["a"], 0, member, 0.0)
    assert len(again["functions"]) == total

    # and the delta is enough for a guest to apply: the rename lands without re-sending the split
    guest, gslug, gpid = _guest_with_demo(tmp_path, built)
    guest.apply_remote_layout(gslug, first["functions"], first["symbols"])
    guest.apply_remote_layout(gslug, later.get("functions") or [], later["symbols"])
    assert guest.store.one("SELECT name FROM functions WHERE project_id=? AND vram=?", gpid, fn["vram"])["name"] \
        == "renamed_by_the_room"


def test_the_guest_is_told_which_room_boundaries_it_cannot_apply(tmp_path, built):  # noqa: F811
    """Boundaries inside a matched function, or outside anything this split has, can't be applied here. The page
    says how many and which (they used to disappear without a trace)."""
    net, slug, pid = _guest_with_demo(tmp_path, built)
    victim = net.store.one("SELECT id,vram FROM functions WHERE project_id=? AND vram IS NOT NULL AND status='open' "
                           "ORDER BY vram LIMIT 1", pid)
    with net.store.tx() as db:
        db.execute("UPDATE functions SET status='matched' WHERE id=?", (victim["id"],))
    report = net.apply_remote_layout(slug, [{"name": "inside_matched", "vram": victim["vram"] + 4, "size": 4},
                                            {"name": "outside_everything", "vram": 0x10, "size": 4}], [])
    assert report["applied"] == 0
    assert report["skipped"] == {"no_owner": 1, "matched": 1, "unsplittable": 0}
    assert len(report["sample"]) == 2 and report["sample"][0].startswith("0x")


def test_a_failing_room_backs_off_and_counts_down(tmp_path, built):  # noqa: F811
    """A room that keeps failing is retried less often, and the page can say why and when (it used to retry every
    2 s forever, so a permanent failure looked like staying online)."""
    net, slug, _ = _guest_with_demo(tmp_path, built)
    link = collab.Link(net, slug, "https://room.trycloudflare.com", "room", "dn_test", "alex")
    net.links[slug] = link

    def failing(method, path, data=None):
        link.error = "can't reach the host (ConnectError)"
        raise NetworkError(link.error)

    link._req = failing
    assert [link._tick(2.0) for _ in range(4)] == [4.0, 8.0, 16.0, 32.0]
    info = net.overview(slug)["room"]
    assert info["failures"] == 4 and info["retry_in"] > 0 and "ConnectError" in info["error"]
    assert info["last_sync"] is None

    link._req = lambda method, path, data=None: {}
    assert link._tick(2.0) == 2.0
    info = net.overview(slug)["room"]
    assert info["failures"] == 0 and info["retry_in"] == 0 and info["last_sync"] is not None
    assert info["sync_ms"] >= 0


def test_a_restarted_app_resumes_from_the_cursor_it_saved(tmp_path, built):  # noqa: F811
    """The member's cursor is kept with the project, so restarting the app syncs what it missed instead of asking
    the host for the whole room again."""
    net, slug, _ = _guest_with_demo(tmp_path, built)
    link = collab.Link(net, slug, "https://room.trycloudflare.com", "room", "dn_test", "alex")
    link._req = lambda method, path, data=None: {}
    link.cursor = {"e": 12, "a": 3, "v": 1, "l": 1700000000.5}
    link._tick(2.0)
    restored = collab.Link(net, slug, "https://room.trycloudflare.com", "room", "dn_test", "alex")
    assert restored.cursor == link.cursor


def test_two_room_boundaries_inside_one_guest_function_both_split(tmp_path, built):  # noqa: F811
    """The host's split is finer than the guest's, so several of its functions can start inside one local function.
    The first boundary used to split it; the second was dropped (the new tail was never looked up again)."""
    net, slug, pid = _guest_with_demo(tmp_path, built)
    victim = net.store.one("SELECT name,vram FROM functions WHERE project_id=? AND vram IS NOT NULL AND status='open' "
                           "AND size>=8 ORDER BY vram LIMIT 1", pid)
    v = victim["vram"]
    net.apply_remote_layout(slug, [{"name": "room_first", "vram": v + 4, "size": 4},
                                   {"name": "room_second", "vram": v + 8, "size": 4}], [])
    names = {r["vram"]: r["name"] for r in net.store.all(
        "SELECT name,vram FROM functions WHERE project_id=? AND vram IN (?,?,?)", pid, v, v + 4, v + 8)}
    assert names == {v: victim["name"], v + 4: "room_first", v + 8: "room_second"}
    sizes = [net.store.one("SELECT size FROM functions WHERE project_id=? AND vram=?", pid, x)["size"]
             for x in (v, v + 4, v + 8)]
    assert sizes[0] == 4 and sizes[1] == 4 and sizes[2] > 4
    # the head's symbol covers only the head now (it used to keep covering the whole old function)
    symbol_sizes = [net.store.one("SELECT size FROM symbols WHERE project_id=? AND address=?", pid, x)["size"]
                    for x in (v, v + 4, v + 8)]
    assert symbol_sizes == sizes


def test_a_room_rename_that_collides_or_swaps_still_syncs(tmp_path, built):  # noqa: F811
    """The room is authoritative for names, but a name it gives one address can already belong to another address
    here (the splits differed) and two names can swap. That used to raise UNIQUE and fail every sync after it."""
    net, slug, pid = _guest_with_demo(tmp_path, built)
    a, b = net.store.all("SELECT name,size,vram FROM functions WHERE project_id=? AND vram IS NOT NULL "
                         "AND status='open' ORDER BY vram LIMIT 2", pid)
    net.apply_remote_layout(slug, [], [{"name": b["name"], "address": a["vram"], "size": a["size"], "kind": "func"},
                                       {"name": a["name"], "address": b["vram"], "size": b["size"], "kind": "func"}])
    moved = {r["vram"]: r["name"] for r in net.store.all(
        "SELECT name,vram FROM functions WHERE project_id=? AND vram IN (?,?)", pid, a["vram"], b["vram"])}
    assert moved == {a["vram"]: b["name"], b["vram"]: a["name"]}

    net.apply_remote_layout(slug, [], [{"name": "clamp_s32", "address": b["vram"], "size": b["size"], "kind": "func"}])
    net.apply_remote_layout(slug, [], [{"name": "clamp_s32", "address": a["vram"], "size": a["size"], "kind": "func"}])
    assert net.store.one("SELECT name FROM functions WHERE project_id=? AND vram=?", pid, a["vram"])["name"] == "clamp_s32"
    # the address that lost its name takes its own back, and still resolves in the symbol table
    displaced = net.store.one("SELECT name FROM functions WHERE project_id=? AND vram=?", pid, b["vram"])["name"]
    assert displaced == f"func_{b['vram']:08X}"
    assert net.symbols(pid).name_at(b["vram"]) == (displaced, 0)
    assert net.symbols(pid).name_at(a["vram"]) == ("clamp_s32", 0)

    # a symbol with no function (an alias splat left behind) holding the name a displaced function would take back:
    # it keeps it, and the function takes the next free name instead of the sync failing on it
    other = net.store.one("SELECT name,size,vram FROM functions WHERE project_id=? AND vram IS NOT NULL AND status='open' "
                         "AND vram NOT IN (?,?) ORDER BY vram LIMIT 1", pid, a["vram"], b["vram"])
    net.apply_remote_layout(slug, [], [{"name": "checksum_save", "address": other["vram"], "size": other["size"],
                                       "kind": "func"}])
    with net.store.tx() as db:
        db.execute("INSERT INTO symbols(project_id,name,address,size,kind) VALUES(?,?,?,?,?)",
                   (pid, f"func_{other['vram']:08X}", a["vram"] + 1, 1, "data"))
    net.apply_remote_layout(slug, [], [{"name": "checksum_save", "address": a["vram"], "size": a["size"], "kind": "func"}])
    assert net.store.one("SELECT name FROM functions WHERE project_id=? AND vram=?", pid, other["vram"])["name"] \
        == f"func_{other['vram']:08X}_2"
    assert net.store.one("SELECT name FROM symbols WHERE project_id=? AND address=?", pid, a["vram"] + 1)["name"] \
        == f"func_{other['vram']:08X}"


def test_a_syncing_room_is_connected_not_offline(tmp_path):
    """The first sync of a big room takes a while to apply; the host is up, so the page must not say offline."""
    net = RomNetwork(tmp_path / "room.db", tmp_path)
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                         ("guest", "Guest", "", "mips", 1, str(tmp_path / "guest"),
                          json.dumps({"kind": "rom", "platform": "n64",
                                      "rom": {"file": "game.z64", "title": "Game"},
                                      "compiler": {"toolchain": "gcc-2.7.2-kmc", "flags": []}}))).lastrowid
        db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                   "VALUES(?,?,?,?,?,?,?)", (pid, 1, "// context\n", None, "import", time.time(), ""))
    link = collab.Link(net, "guest", "https://room.trycloudflare.com", "room", "dn_test", "alex")
    net.links["guest"] = link
    assert net.overview("guest")["room"]["connected"] is False
    link.syncing = True
    assert net.overview("guest")["room"]["connected"] is True
    assert net.overview("guest")["room"]["syncing"] is True
    link.syncing = False
    assert net.overview("guest")["room"]["connected"] is False

    link._req = lambda method, path, data=None: {}  # the room answered; applying {} is empty
    link.sync()
    assert link.last_ok > 0 and link.syncing is False  # the answer counts, so the room stays connected


def test_the_join_route_refuses_the_hosts_own_invite(built, tmp_path, monkeypatch):  # noqa: F811
    """What the GUI's "Join a friend" does: the job fails with the reason and the project stays the host."""
    from decompnet.app.server import build

    home = tmp_path / "home"
    home.mkdir(parents=True, exist_ok=True)
    net = RomNetwork(tmp_path / "live.db", tmp_path / "live")
    slug = net.import_rom(built, confirmed=True, log=lambda *_: None)
    net.rooms[slug] = collab.Room(net, slug)
    code = net.rooms[slug].open_invite()
    hello = {"room": slug, "sha1": "a" * 40, "title": "Demo Quest 64", "kind": "rom", "functions": 4,
             "matched": 0, "compiler": {"toolchain": "gcc-2.7.2-kmc", "flags": []}, "members": 1}
    monkeypatch.setattr(collab, "_hello", lambda http, link: ("http://192.168.1.20:6481", code, hello))
    mcp, _manager, security = build(net, home, 6497, "s3cret")
    client = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                        base_url="http://127.0.0.1:6497")
    client.cookies.set("decomp_live", "s3cret")
    link = f"http://192.168.1.20:6481/join/{code}#room={slug}"
    started = client.post("/api/collab/join", params={"confirmed": "1", "link": link, "name": "hosty",
                                                       "filename": "game.z64"}, content=built,
                          headers={"x-decomp": "1"}).json()
    for _ in range(200):
        job = client.get("/api/job", params={"id": started["job"]}).json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "error" and "hosting a room for this game" in job["error"]
    assert slug not in net.links and net.overview(slug)["room"]["role"] == "host"


def test_linking_the_hosts_own_room_is_refused(built, tmp_path):  # noqa: F811
    host, slug, _room, _code, _client = _host(built, tmp_path)
    info = {"url": "http://192.168.1.20:6481", "room": slug, "token": "dn_test", "member": "hosty"}
    with pytest.raises(NetworkError, match="room host"):
        host.link_project(slug, info)
    assert slug not in host.links and "link" not in json.loads(host.project_row(slug)["config"])


def test_a_shared_project_cant_join_another_room_for_the_same_game(built, tmp_path):  # noqa: F811
    """Two rooms for one game on one computer would mix: the project stays the host."""
    first, slug, _room, _code, _client = _host(built, tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    _h, other_slug, _r, other_code, other_client = _host(built, other)
    link = f"http://192.168.1.20:6481/join/{other_code}#room={other_slug}"
    with pytest.raises(NetworkError, match="hosting a room for this game"):
        collab.join_room(first, link, "firsty", built, client=other_client, log=lambda *_: None, start=False)
    assert slug not in first.links and first.overview(slug)["room"]["role"] == "host"


def test_a_self_link_left_by_an_older_build_is_dropped(built, tmp_path):  # noqa: F811
    """The host's project is a host again on the next start, not a guest of a room nobody hosts."""
    host, slug, _room, _code, _client = _host(built, tmp_path)
    cfg = json.loads(host.project_row(slug)["config"])
    cfg["link"] = {"url": "http://192.168.1.20:6481", "room": slug, "token": "dn_test", "member": "hosty"}
    with host.store.tx() as db:
        db.execute("UPDATE projects SET config=? WHERE slug=?", (json.dumps(cfg), slug))
    host.restore_links()
    assert slug not in host.links
    repaired = json.loads(host.project_row(slug)["config"])
    assert "link" not in repaired and repaired["collab"]["open"]  # still a host: it can share again
    assert host.overview(slug)["room"]["role"] == "host"
