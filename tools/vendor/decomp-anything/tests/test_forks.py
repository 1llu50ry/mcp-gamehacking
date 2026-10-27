"""Fork mode: continue a public decomp inside its own source tree, judged by objdiff.

projects/demo-fork is a small project in the shape community decomps use (objdiff.json, ninja build, partly
decompiled src/), for Demo Quest 64. The test clones it like a repository from decomp.dev, adds the game,
builds it and has an agent work through the guarded tools.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from decompnet import toolchains
from decompnet.app.engine import RomNetwork
from decompnet.forks import catalog, csource
from decompnet.network import NetworkError

ROOT = Path(__file__).resolve().parent.parent
FORK_SRC = ROOT / "projects" / "demo-fork"
ROM = ROOT / "src" / "decompnet" / "app" / "static" / "demo" / "demo-quest-64.z64"
REFERENCE = (FORK_SRC / "tools" / "reference" / "game.c").read_text()

needs_tools = pytest.mark.skipif(
    toolchains.installed("gcc-2.7.2-kmc") is None or toolchains.installed("objdiff-cli") is None
    or not shutil.which("git"), reason="needs gcc-2.7.2-kmc, objdiff-cli and git")


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                          env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                               "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin", "HOME": str(cwd)}).stdout


@pytest.fixture(scope="module")
def fork(tmp_path_factory):
    base = tmp_path_factory.mktemp("fork")
    upstream = base / "upstream"
    shutil.copytree(FORK_SRC, upstream)
    _git(upstream, "init", "-q", "-b", "main")
    _git(upstream, "add", "-A")
    _git(upstream, "commit", "-q", "-m", "initial")
    net = RomNetwork(base / "app.db", base / "work")
    (base / "work").mkdir()
    slug = net.forks.clone(str(upstream), name="Demo Quest decomp", platform="n64", log=lambda *_: None)
    need = net.forks.needs(slug)
    assert need["kind"] == "manifest" and need["path"] == "baserom.z64"
    with pytest.raises(NetworkError, match="sha1"):
        net.forks.setup(slug, b"\0" * 1024, "nope.z64", log=lambda *_: None)
    m = net.forks.setup(slug, ROM.read_bytes(), "demo.z64", log=lambda *_: None)
    assert m["total_functions"] == 13
    agent, _ = net.local_agent("claude-1")
    return net, slug, agent


def _ref(name: str) -> str:
    return csource.get(REFERENCE, name).strip()


@needs_tools
def test_fork_state_after_setup(fork):
    net, slug, _agent = fork
    ov = net.overview(slug)
    assert ov["kind"] == "fork" and ov["ready"] and ov["functions"] == 13
    assert ov["matched"] == 4  # clamp_s32, abs_s32, rng_next, add_score
    rows = {r["name"]: r for r in net.function_map(slug)}
    assert rows["clamp_s32"]["status"] == "matched" and rows["lerp"]["status"] == "open"
    assert "fork of" in net.forks.info(slug) and "functions" in net.forks.info(slug)


@needs_tools
def test_agent_matches_a_new_function_and_commits(fork):
    net, slug, agent = fork
    brief = net.claim(agent, slug, "lerp")
    assert "Target assembly" in brief and "src/game.c" in brief and "Not in src/game.c yet" in brief
    res = net.attempt(agent, "lerp", _ref("lerp"), slug)
    assert res["matched"], res["text"]
    text = (Path(net.project_row(slug)["root"]) / "src" / "game.c").read_text()
    # placed where it was in the original: after add_score, before the later player_take_damage
    assert text.index("void add_score(") < text.index("lerp(") < text.index("void player_take_damage(")
    log = _git(Path(net.project_row(slug)["root"]), "log", "--oneline", "decomp-wtf")
    assert "Match lerp" in log
    assert net.overview(slug)["matched"] == 5


@needs_tools
def test_decomp_wtfs_own_tries_leave_no_claim_behind(fork):
    """A twin's code tried on an unclaimed function used to leave it claimed by the autopilot for 30 minutes (agents
    were kept off it), and the expiry counted as giving up on it: Mario Party 6 had 3,132 such expiries in 5 hours."""
    net, slug, _ = fork
    autopilot, _ = net.local_agent("autopilot")
    name = "checksum_save"
    fn = net.store.one("SELECT id, status, abandons FROM functions WHERE name=?", name)
    if fn["status"] != "open" or net.store.one("SELECT 1 FROM claims WHERE function_id=?", fn["id"]):
        pytest.skip("checksum_save isn't open and free in this run")
    res = net.forks.attempt(autopilot, slug, name, _ref(name).replace("return", "return 1 +", 1), keep=False)
    assert not res["matched"]
    assert net.store.one("SELECT 1 FROM claims WHERE function_id=?", fn["id"]) is None
    with net.store.tx() as db:  # one cut short by a restart runs out: nobody gave up on the function
        db.execute("INSERT INTO claims VALUES(?,?,?,?)", (fn["id"], autopilot.id, 0, 1))
        net._expire_claims(db)
    assert net.store.one("SELECT abandons FROM functions WHERE id=?", fn["id"])["abandons"] == fn["abandons"]


@needs_tools
def test_near_miss_gets_a_diff_and_release_restores_the_best(fork):
    net, slug, agent = fork
    root = Path(net.project_row(slug)["root"])
    net.claim(agent, slug, "count_alive_entities")
    good = _ref("count_alive_entities")
    near, worse = good.replace("return n;", "return n + 1;"), good.replace("n++;", "n += 2;")
    assert near != good and worse != good
    first = net.attempt(agent, "count_alive_entities", near, slug)
    assert not first["matched"] and first["score"] and "TARGET" in first["text"]
    d = net.function_diff(slug, "count_alive_entities")
    assert d["kind"] == "latest" and 0 < d["percent"] < 100 and any(r[0] != " " for r in d["rows"])
    second = net.attempt(agent, "count_alive_entities", worse, slug)
    assert second["score"] is not None
    net.release(agent, "count_alive_entities", "testing release", slug)
    best = net.store.one("SELECT best_source FROM functions WHERE name='count_alive_entities'")["best_source"]
    assert best.strip() in (root / "src" / "game.c").read_text()


@needs_tools
def test_guards(fork):
    net, slug, agent = fork
    root = Path(net.project_row(slug)["root"])
    net.claim(agent, slug, "checksum_save")
    before = (root / "src" / "game.c").read_text()
    with pytest.raises(NetworkError, match="assembly"):
        net.attempt(agent, "checksum_save", 'u32 checksum_save(u8 *p, s32 n) { __asm__("nop"); return 0; }', slug)
    with pytest.raises(NetworkError, match="with edit_file first"):
        net.attempt(agent, "checksum_save", "struct X { int a; };\n" + _ref("checksum_save"), slug)
    broken = net.attempt(agent, "checksum_save", "u32 checksum_save(void) { return undefined_thing; }", slug)
    assert broken["score"] is None and "BUILD ERROR" in broken["text"]
    assert (root / "src" / "game.c").read_text() == before
    for bad in ("configure.py", "build/expected/game.o", "../outside.c", "objdiff.json", "tools/reference/game.c"):
        with pytest.raises(NetworkError):
            net.forks.edit_file(agent, slug, bad, "", "int x;", "nope")
    with pytest.raises(NetworkError, match="ROM projects"):
        net.get_context(slug)
    # a header edit that would break matches is undone
    header = (root / "include" / "game.h").read_text()
    res = net.forks.edit_file(agent, slug, "include/game.h", "#define MAX_SCORE 999999", "#define MAX_SCORE 5000", "cap")
    assert res.startswith("❌") and "add_score" in res and (root / "include" / "game.h").read_text() == header
    # one that keeps every match is committed
    res = net.forks.edit_file(agent, slug, "include/game.h", "", "#define SAVE_MAGIC 0x5A5A", "save magic")
    assert res.startswith("✅") and "SAVE_MAGIC" in (root / "include" / "game.h").read_text()
    assert net.overview(slug)["matched"] >= 5
    net.release(agent, "checksum_save", "", slug)


@needs_tools
def test_read_and_search(fork):
    net, slug, _agent = fork
    assert "clamp_s32" in net.forks.read_file(slug, "src/game.c")
    assert "game.h" in net.forks.search(slug, r"MAX_ENTITIES")
    with pytest.raises(NetworkError):
        net.forks.read_file(slug, ".git/config")
    with pytest.raises(NetworkError, match="source or text"):
        net.forks.read_file(slug, "baserom.z64")
    assert "../" not in net.forks.search(slug, "x", "../**/*.c")


@needs_tools
def test_function_detail(fork):
    net, slug, _agent = fork
    d = net.function_detail(slug, "clamp_s32")
    assert d["status"] == "matched" and "slt" in d["asm"] and "clamp_s32" in d["source"]


def test_csource_finds_definitions_and_stubs():
    src = ('s32 f(s32 a) {\n    return a; /* } */\n}\nINCLUDE_ASM("asm/nonmatchings/x", g);\n'
           'uLong h(a)\n    uLong a;\n{\n    return a;\n}\nvoid C::m(int x) {\n}\n')
    assert csource.get(src, "f").startswith("s32 f(") and csource.get(src, "f").endswith("}\n")
    assert "INCLUDE_ASM" in csource.get(src, "g")
    assert csource.get(src, "h").startswith("uLong h(a)")
    assert csource.get(src, "C::m").startswith("void C::m")
    assert csource.get(src, "missing") is None
    assert "return 1" in csource.replace(src, "g", "int g(void) { return 1; }")


def test_catalog_normalizes_decomp_dev():
    raw = {"projects": [{"owner": "o", "repo": "r", "name": "Game", "platform": "gc", "default_version": "GALE01",
                         "commit": {"timestamp": "2026-10-01T00:00:00Z"},
                         "measures": {"matched_code_percent": 42.123, "total_functions": 10, "matched_functions": 4}}]}
    p = catalog.normalize(raw)[0]
    assert p["id"] == "o/r" and p["platform_name"] == "GameCube" and p["matched"] == 42.12
    assert p["repo_url"] == "https://github.com/o/r"


def test_clone_rejects_odd_sources(tmp_path):
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    for bad in ("file:///etc", "https://evil.example/x/y", "--upload-pack=x", str(tmp_path)):
        with pytest.raises(NetworkError):
            net.forks.clone(bad, log=lambda *_: None)


@needs_tools
def test_find_similar(fork):
    net, slug, _agent = fork
    out = net.find_similar(slug, "entity_spawn")
    assert "index covers" in out or "Functions that look like" in out


def test_similarity_ranks_copies_first():
    from decompnet import similarity

    a = ["addiu", "sw", "lw", "addu", "slt", "bnez", "nop", "jr", "addiu"]
    cands = {"copy": list(a), "tweaked": [*a[:4], "sltu", *a[5:]], "other": ["lui", "ori", "jal", "nop"] * 3}
    ranked = similarity.rank(a, cands, top=3)
    assert [n for n, _ in ranked][:2] == ["copy", "tweaked"] and ranked[0][1] == 1.0


@pytest.mark.skipif(toolchains.installed("m2c") is None, reason="needs m2c")
def test_drafts_from_project_assembly(tmp_path):
    from decompnet.forks import drafts

    (tmp_path / "asm" / "nonmatchings" / "game").mkdir(parents=True)
    (tmp_path / "asm" / "nonmatchings" / "game" / "func_80001234.s").write_text(
        "glabel func_80001234\n"
        "/* 1234 80001234 27BDFFE8 */  addiu      $sp, $sp, -0x18\n"
        "/* 1238 80001238 AFBF0010 */  sw         $ra, 0x10($sp)\n"
        "/* 123C 8000123C 0C000000 */  jal        func_80000000\n"
        "/* 1240 80001240 00000000 */   nop\n"
        "/* 1244 80001244 8FBF0010 */  lw         $ra, 0x10($sp)\n"
        "/* 1248 80001248 03E00008 */  jr         $ra\n"
        "/* 124C 8000124C 27BD0018 */   addiu     $sp, $sp, 0x18\n")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "game.c").write_text('INCLUDE_ASM("asm/nonmatchings/game", func_80001234);\n')
    out = drafts.draft(tmp_path, "n64", "game", "func_80001234", "src/game.c")
    assert out and "func_80000000();" in out
    assert csource.is_stub('INCLUDE_ASM("asm/nonmatchings/game", func_80001234);')
    assert drafts.draft(tmp_path, "win32", "game", "func_80001234", "src/game.c") is None


@needs_tools
def test_ghidra_drafts_for_a_unit(fork):
    from decompnet.forks import ghidra

    if not ghidra.available():
        pytest.skip("needs Ghidra and Java 21+")
    net, slug, _agent = fork
    root = Path(net.project_row(slug)["root"])
    out = ghidra.decompile_object(root / "build" / "expected" / "game.o", root / ".decomp-wtf" / "ghidra")
    assert "clamp_s32" in out and "return" in out["clamp_s32"]


@needs_tools
def test_rewriting_a_matched_function_must_keep_it_matching(fork):
    net, slug, agent = fork
    root = Path(net.project_row(slug)["root"])
    before = (root / "src" / "game.c").read_text()
    res = net.attempt(agent, "clamp_s32", "s32 clamp_s32(s32 v, s32 lo, s32 hi) { return v; }", slug)
    assert not res["matched"] and "already matches" in res["text"]
    assert (root / "src" / "game.c").read_text() == before
    assert net.store.one("SELECT status FROM functions WHERE name='clamp_s32'")["status"] == "matched"


def _dtk_project(root: Path, version: str, config: str) -> None:
    (root / "config" / version).mkdir(parents=True)
    (root / "config" / version / "config.yml").write_text(config)
    (root / "configure.py").write_text("# dtk-template\n")
    (root / "orig" / version).mkdir(parents=True)


def test_a_project_that_reads_an_extracted_disc_gets_its_files_from_the_disc_image(tmp_path, monkeypatch):
    """Older dtk projects read orig/<version>/sys/main.dol and files/... (the README says "extract the disc with
    Dolphin"); decomp.wtf copies exactly those files out of the user's disc image, picking the disc of that version."""
    from decompnet.forks import scratch_dtk
    from decompnet.forks.project import ForkProject

    _dtk_project(tmp_path, "GP6E01", "object: orig/GP6E01/sys/main.dol\nmodules:\n- object: orig/GP6E01/files/dll/a.rel\n"
                                     "- object: 'orig/GP6E01/files/dll/b.rel'\n")
    for name in ("eu.rvz", "us.rvz"):
        (tmp_path / "orig" / "GP6E01" / name).write_bytes(b"RVZ\x01" + bytes(2 << 20))
    monkeypatch.setattr(scratch_dtk, "disc_id", lambda p: {"eu.rvz": "GP6P01", "us.rvz": "GP6E01"}.get(p.name))
    copied = []

    def fake_copy(disc, inner, dest):
        copied.append((disc.name, list(inner), dest.relative_to(tmp_path).as_posix()))
        for x in inner:
            (dest / Path(x).name).parent.mkdir(parents=True, exist_ok=True)
            (dest / Path(x).name).write_bytes(b"x")
    monkeypatch.setattr(scratch_dtk, "vfs_copy", fake_copy)
    fp = ForkProject(tmp_path)
    assert fp.unpack_disc("GP6E01", log=lambda *_: None) == 3
    assert sorted(copied) == [("us.rvz", ["files/dll/a.rel", "files/dll/b.rel"], "orig/GP6E01/files/dll"),
                              ("us.rvz", ["sys/main.dol"], "orig/GP6E01/sys")]
    assert fp.unpack_disc("GP6E01", log=lambda *_: None) == 0  # everything is there now
    # a project whose dtk reads the disc image itself is left alone
    other = tmp_path / "new"
    _dtk_project(other, "GALE01", "object_base: orig/GALE01\nobject: sys/main.dol\n")
    assert ForkProject(other).unpack_disc("GALE01", log=lambda *_: None) == 0


def test_a_disc_of_another_version_switches_the_project_or_is_refused(tmp_path, monkeypatch):
    from decompnet.forks import scratch_dtk

    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "ws")
    root = tmp_path / "ws" / "mp6"
    _dtk_project(root, "GP6E01", "object: orig/GP6E01/sys/main.dol\n")
    (root / "config" / "GP6P01").mkdir(parents=True)
    (root / "config" / "GP6P01" / "config.yml").write_text("object: orig/GP6P01/sys/main.dol\n")
    net.forks._register("mp6", "Mario Party 6", "fork", root, {"kind": "fork", "version": "GP6E01", "fork_kind": "dtk"}, "x")
    proj, fp, cfg = net.forks.get("mp6")
    disc = tmp_path / "game.rvz"
    disc.write_bytes(b"RVZ\x01")
    monkeypatch.setattr(scratch_dtk, "disc_id", lambda p: "GP6P01")
    net.forks._match_version(proj, fp, cfg, disc, log=lambda *_: None)
    assert net.forks.get("mp6")[2]["version"] == "GP6P01"
    monkeypatch.setattr(scratch_dtk, "disc_id", lambda p: "GP6J01")
    with pytest.raises(NetworkError, match=r"GP6J01.*GP6E01, GP6P01"):
        net.forks._match_version(*net.forks.get("mp6"), disc, log=lambda *_: None)


def test_a_project_made_from_scratch_builds_with_this_computers_tools(tmp_path, monkeypatch):
    """The manifest of a generated project records the tools of the computer that made it; setup uses this one's."""
    from decompnet.forks import scratch_dsd
    from decompnet.forks.project import ForkProject

    (tmp_path / ".decomp.wtf.json").write_text(json.dumps({
        "created": "from scratch", "platform": "nds", "version": "abce",
        "setup": [["python", "tools/configure.py", "abce", "--dsd", "/elsewhere/dsd", "--compilers", "/elsewhere/mw"], ["ninja"]]}))
    monkeypatch.setattr(scratch_dsd, "tool_args", lambda: ["--dsd", "/here/dsd", "--compilers", "/here/mw"])
    cmds = ForkProject(tmp_path).setup_commands("abce")
    assert cmds[0][1:] == ["tools/configure.py", "abce", "--dsd", "/here/dsd", "--compilers", "/here/mw"]
    assert cmds[1] == ["ninja"]


@needs_tools
def test_a_unit_without_a_compiled_object_is_measured_as_not_matched(fork, tmp_path):
    """Work in progress that doesn't compile, or units the default build never compiles: the report still works,
    and those units count as not matched yet instead of stopping the whole measurement."""
    from decompnet.forks import objdiff

    net, slug, _ = fork
    root = Path(net.project_row(slug)["root"])
    copy = tmp_path / "copy"
    shutil.copytree(root, copy, symlinks=True)
    cfg = json.loads((copy / "objdiff.json").read_text())
    unit = next(u for u in cfg["units"] if u.get("base_path") and (copy / u["base_path"]).is_file())
    (copy / unit["base_path"]).unlink()
    rep = objdiff.report(copy, tmp_path / "report.json")
    got = next(u for u in rep["units"] if u["name"] == unit["name"])
    assert all((f.get("fuzzy_match_percent") or 0) < 100 for f in got.get("functions", []))
    assert len(rep["units"]) == len(cfg["units"])


def test_two_functions_of_the_same_name_in_one_unit_both_get_a_row(tmp_path, monkeypatch):
    """Mario Party 6 has two static `_langGetNbrSpeechUnit` in one unit: measuring must not trip over that."""
    from decompnet.forks.project import ForkProject

    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "ws")
    root = tmp_path / "ws" / "p"
    root.mkdir(parents=True)
    (root / "objdiff.json").write_text(json.dumps({"units": []}))
    net.forks._register("p", "P", "fork", root, {"kind": "fork", "version": "X", "fork_kind": "objdiff", "ready": False}, "x")
    def fn(name, addr, pct=None):
        return {"name": name, "size": "12", "metadata": {"virtual_address": str(addr)},
                **({"fuzzy_match_percent": pct} if pct is not None else {})}
    report = {"measures": {}, "units": [
        {"name": "main/lang", "functions": [fn("_lang", 1, 100.0), fn("_lang", 2), fn("init", 3)]},
        {"name": "main/other", "functions": [fn("init", 4)]}]}
    monkeypatch.setattr(ForkProject, "report", lambda self: report)
    monkeypatch.setattr(ForkProject, "units", lambda self: [])
    for _ in range(2):  # measuring again updates the same rows
        net.forks.sync("p", log=lambda *_: None)
    rows = {r["name"]: r for r in net.store.all("SELECT name, vram, status FROM functions")}
    assert set(rows) == {"_lang@main/lang", "_lang@main/lang#2", "init@main/lang", "init@main/other"}
    assert rows["_lang@main/lang"]["vram"] == 1 and rows["_lang@main/lang#2"]["vram"] == 2


@needs_tools
def test_a_public_decomp_together(tmp_path):
    """A room on a fork of a public decomp: the member gets the public project from its own host (here a local
    'upstream'), at the commit the room's host started from, plus the room's commits as a bundle; then builds it with
    their own copy of the game and works with the room."""
    from starlette.testclient import TestClient

    from decompnet.app import collab

    upstream = tmp_path / "upstream"
    shutil.copytree(FORK_SRC, upstream)
    _git(upstream, "init", "-q", "-b", "main")
    _git(upstream, "add", "-A")
    _git(upstream, "commit", "-q", "-m", "initial")
    (tmp_path / "host").mkdir()
    host = RomNetwork(tmp_path / "host.db", tmp_path / "host")
    slug = host.forks.clone(str(upstream), name="Demo Quest decomp", platform="n64", log=lambda *_: None)
    host.forks.setup(slug, ROM.read_bytes(), "demo.z64", log=lambda *_: None)
    hagent, _ = host.local_agent("claude-host")
    assert host.attempt(hagent, "count_alive_entities", _ref("count_alive_entities"), slug)["matched"]
    _git(upstream, "commit", "-q", "--allow-empty", "-m", "upstream moved on")  # members still start where the host did

    host.rooms[slug] = collab.Room(host, slug)
    code = host.rooms[slug].open_invite()
    client = TestClient(collab.host_app(host, host.rooms), base_url="https://abc.trycloudflare.com")
    (tmp_path / "guest").mkdir()
    guest = RomNetwork(tmp_path / "guest.db", tmp_path / "guest")
    gslug = collab.join_room(guest, f"https://abc.trycloudflare.com/join/{code}#room={slug}", "alex", ROM,
                             log=lambda *_: None, client=client, start=False)
    hroot, groot = Path(host.project_row(slug)["root"]), Path(guest.project_row(gslug)["root"])
    head = lambda root: subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True).stdout  # noqa: E731
    assert head(groot) == head(hroot)
    assert guest.overview(gslug)["functions"] == host.overview(slug)["functions"]
    assert guest._function("count_alive_entities", gslug)["status"] == "matched"  # the host's match came along

    gagent, _ = guest.local_agent("claude-1")
    assert "CLAIMED" in guest.forks.claim(gagent, gslug, "lerp")
    res = guest.attempt(gagent, "lerp", _ref("lerp"), gslug)
    assert res["matched"] and "host confirmed" in res["text"], res["text"]
    assert host._function("lerp", slug)["status"] == "matched"
    guest.links[gslug].sync()
    assert head(groot) == head(hroot)


def test_the_retired_decomp_dev_directory_is_never_asked_for(tmp_path, monkeypatch):
    """#21: decomp.dev retired its project directory (410 Gone). decomp.wtf doesn't ask for it: an install keeps
    showing the list it downloaded before, or none."""
    import json
    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: pytest.fail("decomp.wtf asked the network"))
    cache = tmp_path / "catalog.json"
    assert catalog.catalog(cache) == [] and catalog.cached_at(cache) is None
    cache.write_text(json.dumps({"projects": [{"owner": "o", "repo": "r", "platform": "gc"}]}))
    assert [p["id"] for p in catalog.catalog(cache)] == ["o/r"] and catalog.cached_at(cache)


def test_a_projects_own_words_on_ai_come_before_forking(tmp_path):
    """#21: every project decides about AI for itself. What its README, CONTRIBUTING and agent files say is read
    (a partial clone, any git host) and shown before anything is forked, with which way it leans."""
    from decompnet.forks import policy

    assert policy.lean(policy.lines_about_ai("We do **not** accept AI-generated code (ChatGPT, Copilot, ...).")) == "no"
    assert policy.lean(policy.lines_about_ai("Contributions made with LLMs are welcome if you review them.")) == "yes"
    assert policy.lean(policy.lines_about_ai("Said the mail: it is plain.")) == "silent"  # "AI" in capitals only
    melee = ("Introduction - Coding Style - Compiler Notes - Pull Requests - AI Assistance\n\nUsing AI to match functions "
             "is acceptable and frequently practiced. Do not let AI name fields in structs.")
    assert policy.lines_about_ai(melee)[0].startswith("Using AI") and policy.lean(policy.lines_about_ai(melee)) == "rules"
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "README.md").write_text("# Some decomp\n\nBuild with ninja.\n")
    (repo / ".github").mkdir()
    (repo / ".github" / "CONTRIBUTING.md").write_text("Rules.\n\nPull requests written by AI tools will be closed.\n")
    (repo / "src.c").write_text("/* not read: AI */\n")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "initial")
    got = policy.check(f"file://{repo}")
    assert got["error"] is None and set(got["files"]) == {"README.md", ".github/CONTRIBUTING.md"}
    assert got["lines"] == [{"file": ".github/CONTRIBUTING.md", "text": "Pull requests written by AI tools will be closed."}]
    assert got["lean"] == "no"
    assert policy.check(f"file://{tmp_path}/nothing")["error"].startswith("couldn't read the repository")


def test_c_code_going_into_a_cpp_file_gets_c_linkage(tmp_path, monkeypatch):
    """A twin's code from a C file tried in one of decomp.wtf's C++ files built, but had no fn_1_BB34 in it (the
    name was mangled): 471 of Mario Party 6's twin misses. With extern "C" on it and its prototypes, it matches."""
    from types import SimpleNamespace

    from decompnet.app import forkengine

    net = RomNetwork(tmp_path / "app.db", tmp_path)
    units = {"a": SimpleNamespace(source="src/a.c"), "b": SimpleNamespace(source="src/b.cpp"),
             "c": SimpleNamespace(source="src/c.cpp")}
    monkeypatch.setattr(forkengine, "ForkProject", lambda root: SimpleNamespace(unit=lambda name: units[name]))
    def row(name, unit):
        return {"name": name, "unit": unit, "meta": json.dumps({"symbol": name})}
    source = "extern void __dl__FPv(void *ptr);\nint fn_1_BB34(int p) {\n    __dl__FPv((void *)p);\n    return p;\n}\n"
    got = net.forks.c_linkage({"root": str(tmp_path)}, row("fn_1_1EE74", "a"), row("fn_1_BB34", "b"), source)
    assert got == 'extern "C" void __dl__FPv(void *ptr);\nextern "C" int fn_1_BB34(int p) {\n    __dl__FPv((void *)p);\n    return p;\n}\n'
    assert net.forks.c_linkage({"root": str(tmp_path)}, row("fn_1_1", "c"), row("fn_1_BB34", "b"), source) is None  # C++ to C++
    static = source.replace("int fn_1_BB34", "static int fn_1_BB34")
    assert net.forks.c_linkage({"root": str(tmp_path)}, row("fn_1_1EE74", "a"), row("fn_1_BB34", "b"), static) is None
