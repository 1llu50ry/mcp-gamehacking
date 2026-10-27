"""Rooms for git projects: a host and a member, each with their own copy of Demo Quest DS (a DS game started from
scratch, so a ds-decomp source tree) and their own compilers. The member gets the host's tree as git bundles, builds
it with their own copy, and works with the room: claims through the host, matches confirmed and committed there,
edits of shared files made there, and the host's commits followed."""

import json
import re
import subprocess
from pathlib import Path

import pytest
from elftools.elf.elffile import ELFFile
from starlette.testclient import TestClient

from decompnet.app import collab
from decompnet.app.engine import RomNetwork
from decompnet.forks import csource
from decompnet.network import NetworkError

from .test_ds import ELF, GAME, ROM, pytestmark  # noqa: F401  (needs CodeWarrior for DS and ds-decomp)


def _syms():
    return {s.name: s["st_value"] for s in ELFFile(open(ELF, "rb")).get_section_by_name(".symtab").iter_symbols()}


def _code(name: str, syms: dict) -> str:
    auto = f"func_{syms[name]:08x}"
    return csource.get(GAME.read_text(), name).replace(name + "(", auto + "(", 1).replace("g_player", f"data_{syms['g_player']:08x}")


def _git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True).stdout.strip()


@pytest.fixture(scope="module")
def room(tmp_path_factory):
    if not ROM.exists():
        pytest.skip("needs the demo DS ROM")
    h = tmp_path_factory.mktemp("host")
    host = RomNetwork(h / "d.db", h)
    slug = host.import_rom(ROM, confirmed=True, log=lambda *_: None)
    host.rooms[slug] = collab.Room(host, slug)
    code = host.rooms[slug].open_invite()
    client = TestClient(collab.host_app(host, host.rooms), base_url="https://abc.trycloudflare.com")
    g = tmp_path_factory.mktemp("guest")
    guest = RomNetwork(g / "d.db", g)
    link = f"https://abc.trycloudflare.com/join/{code}#room={slug}"
    said = []
    gslug = collab.join_room(guest, link, "alex", ROM, log=said.append, client=client, start=False)
    return host, slug, guest, gslug, client, link, said


def test_the_member_gets_the_tree_and_builds_it_with_their_own_copy(room):
    host, slug, guest, gslug, _client, _link, said = room
    hroot, groot = Path(host.project_row(slug)["root"]), Path(guest.project_row(gslug)["root"])
    assert _git(groot, "rev-parse", "HEAD") == _git(hroot, "rev-parse", "HEAD")  # the host's commits, as they are
    assert (groot / "extract" / "baserom.nds").exists()  # the member's own copy, placed by the member's setup
    tracked = _git(groot, "ls-files").split()
    assert not [f for f in tracked if f.startswith(("extract/", "build/"))]  # no game data ever came with the tree
    gov, hov = guest.overview(gslug), host.overview(slug)
    assert gov["ready"] and gov["functions"] == hov["functions"] >= 100
    assert gov["room"]["role"] == "guest" and any("building the project" in s for s in said)


def test_joining_needs_the_same_game(room, tmp_path):
    _host, _slug, _guest, _gslug, client, link, _said = room
    other = RomNetwork(tmp_path / "o.db", tmp_path)
    changed = bytearray(ROM.read_bytes())
    changed[0x5000] ^= 0xFF  # a byte of the ARM9 program
    (tmp_path / "other.nds").write_bytes(bytes(changed))
    with pytest.raises(NetworkError, match="same game"):
        collab.join_room(other, link, "eve", tmp_path / "other.nds", log=lambda *_: None, client=client, start=False)


def test_state_and_bundles_carry_work_never_the_game(room):
    _host, slug, guest, gslug, client, _link, _said = room
    tok = guest.links[gslug].token
    st = client.get(f"/collab/state?room={slug}", headers={"authorization": f"Bearer {tok}"}).json()
    assert st["head"] and st["members"][0]["name"] == "alex" and "functions" not in st and "context" not in st
    assert client.get(f"/collab/bundle?room={slug}", headers={"authorization": "Bearer dn_nope"}).status_code == 400
    r = client.get(f"/collab/bundle?room={slug}&have={st['head']}", headers={"authorization": f"Bearer {tok}"})
    assert r.status_code == 204  # up to date: nothing to send


def test_a_members_match_is_confirmed_and_committed_by_the_host(room):
    host, slug, guest, gslug, _client, _link, _said = room
    syms = _syms()
    agent, _ = guest.local_agent("claude-1")
    hroot = Path(host.project_row(slug)["root"])
    # the game's types first: an edit of a shared header, made and checked by the host, followed here
    player = f"data_{syms['g_player']:08x}"
    types = "\n".join(line for line in (GAME.parent / "game.h").read_text().splitlines()
                      if not line.startswith(("#include", "typedef signed", "typedef unsigned", "typedef float", "#define NULL")))
    types = types.replace("extern Player g_player;", f"extern Player {player};")
    out = guest.forks.edit_file(agent, gslug, "include/common.h", "", types, "the game's types")
    assert out.startswith("✅"), out
    assert "Edited by alex.claude-1" in _git(hroot, "log", "-1", "--format=%B")  # the host made the commit
    groot = Path(guest.project_row(gslug)["root"])
    assert player in (groot / "include" / "common.h").read_text()  # and this copy has it already

    fn = f"func_{syms['clamp_s32']:08x}"
    brief = guest.forks.claim(agent, gslug, fn)
    assert brief.startswith("## CLAIMED") or "CLAIMED" in brief
    assert [c["agent"] for c in host.live(slug)["claims"]] == ["alex.claude-1"]  # held in the room, not just here
    res = guest.attempt(agent, fn, _code("clamp_s32", syms), gslug)
    assert res["matched"] and "host confirmed" in res["text"], res["text"]
    assert host._function(fn, slug)["status"] == "matched"
    assert re.search(r"^Match ", _git(hroot, "log", "-1", "--format=%s"))
    guest.links[gslug].sync()
    assert _git(groot, "rev-parse", "HEAD") == _git(hroot, "rev-parse", "HEAD")


def test_the_hosts_work_reaches_the_member(room):
    host, slug, guest, gslug, _client, _link, _said = room
    syms = _syms()
    agent, _ = host.local_agent("claude-host")
    fn = f"func_{syms['abs_s32']:08x}"
    assert host.forks.claim(agent, slug, fn)
    assert host.attempt(agent, fn, _code("abs_s32", syms), slug)["matched"]
    guest.links[gslug].sync()
    groot, hroot = Path(guest.project_row(gslug)["root"]), Path(host.project_row(slug)["root"])
    assert _git(groot, "rev-parse", "HEAD") == _git(hroot, "rev-parse", "HEAD")
    row = guest._function(fn, gslug)
    assert row["status"] == "matched"  # measured in this copy, after its build
    who = guest.store.one("SELECT name FROM agents WHERE id=?", row["matched_agent_id"])
    assert who and who["name"] in ("@claude-host", "@host")
    assert any(f["agent"] for f in guest.function_map(gslug)) is not None


def test_work_in_progress_survives_following_the_host(room):
    host, slug, guest, gslug, _client, _link, _said = room
    syms = _syms()
    other = f"func_{syms['player_take_damage']:08x}"
    busy = guest._function(other, gslug)["unit"]
    gagent, _ = guest.local_agent("claude-2")
    # the member works in another file than the host's next match
    fn = next(r["name"] for r in guest.store.all("SELECT name, unit FROM functions WHERE project_id=? AND status='open' "
                                                 "ORDER BY name", guest.project_row(gslug)["id"]) if r["unit"] != busy)
    guest.forks.claim(gagent, gslug, fn)
    res = guest.attempt(gagent, fn, f"int {fn}(void) {{ return 4; }}", gslug)  # an attempt, not a match: stays in its file
    assert not res["matched"]
    groot = Path(guest.project_row(gslug)["root"])
    src = next(p for p in (groot / "src").rglob("*.c") if f"{fn}(void) {{ return 4; }}" in p.read_text())
    hagent, _ = host.local_agent("claude-host2")
    host.forks.claim(hagent, slug, other)
    assert host.attempt(hagent, other, _code("player_take_damage", syms), slug)["matched"]
    guest.links[gslug].sync()
    assert "return 4;" in src.read_text()  # the member's attempt is still there, on top of the host's commits
    assert guest._function(other, gslug)["status"] == "matched"
    assert _git(groot, "rev-parse", "HEAD") == _git(Path(host.project_row(slug)["root"]), "rev-parse", "HEAD")
    guest.forks.release(gagent, gslug, fn, "")
    assert not host.live(slug)["claims"]


def test_the_hosts_version_wins_where_both_changed_the_same_lines(room):
    host, slug, guest, gslug, _client, _link, _said = room
    hroot, groot = Path(host.project_row(slug)["root"]), Path(guest.project_row(gslug)["root"])
    rel = "include/common.h"
    (groot / rel).write_text((groot / rel).read_text() + "\n#define MEMBER_ONLY 1\n")  # unsaved work here
    hagent, _ = host.local_agent("claude-host3")
    assert host.forks.edit_file(hagent, slug, rel, "", "#define HOST_SIDE 2", "a constant").startswith("✅")
    guest.links[gslug].sync()
    text = (groot / rel).read_text()
    assert "HOST_SIDE" in text and "MEMBER_ONLY" not in text and "<<<<<<<" not in text
    assert _git(groot, "rev-parse", "HEAD") == _git(hroot, "rev-parse", "HEAD")
    assert not _git(groot, "stash", "list")  # nothing left behind


def test_reconnecting_keeps_the_place_in_the_tree(room):
    host, slug, guest, gslug, client, link, _said = room
    head = json.loads(guest.project_row(gslug)["config"])["link"]["head"]
    assert head == _git(Path(host.project_row(slug)["root"]), "rev-parse", "HEAD")
    assert collab.join_room(guest, link, "alex", b"", log=lambda *_: None, client=client, start=False) == gslug
    assert guest.links[gslug].head == head
