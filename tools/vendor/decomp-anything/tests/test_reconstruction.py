"""A game recovers code the way an app project does: matched byte for byte where the original toolchain allows it,
reconstructed where it doesn't, and the two are never mixed up."""

import json
import time
import zipfile

import pytest
from starlette.testclient import TestClient

from decompnet.app import tools
from decompnet.app.engine import RomNetwork
from decompnet.app.server import build
from decompnet.network import NetworkError

GAME_CFG = {"kind": "rom", "platform": "n64", "big_endian": True,
            "compiler": {"toolchain": "gcc-2.7.2-kmc", "flags": ["-O2"]},
            "rom": {"file": "game.z64", "title": "Game"}}


def add_project(net, tmp_path, slug, config, functions):
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                         (slug, "Game", "", "mips", 1, str(tmp_path / slug), json.dumps(config))).lastrowid
        for name, status, unit, meta in functions:
            db.execute("INSERT INTO functions(project_id,name,size,n_insns,status,unit,meta,vram,relocs,asm) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (pid, name, 40, 10, status, unit, json.dumps(meta), 0x80001000, "[]", ""))
        db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                   "VALUES(?,?,?,?,?,?,?)", (pid, 1, "// context\n", None, "import", time.time(), ""))
        (tmp_path / slug).mkdir(parents=True, exist_ok=True)
    return pid


def claim(net, agent, slug, name):
    fn = net._function(name, slug)
    now = time.time()
    with net.store.tx() as db:
        db.execute("INSERT OR REPLACE INTO claims VALUES(?,?,?,?)", (fn["id"], agent.id, now, now + 600))
    return fn


@pytest.fixture
def game(tmp_path):
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    add_project(net, tmp_path, "game", GAME_CFG, [
        ("clamp_s32", "open", "src/game", {"kind": "procedure"}),
        ("abs_s32", "open", "src/game", {"kind": "procedure"}),
        ("matched_one", "matched", "src/game", {"kind": "procedure"}),
    ])
    return net, net.authenticate(net.register_agent("alice"))


def test_a_game_function_can_be_reconstructed(game, tmp_path):
    net, alice = game
    claim(net, alice, "game", "clamp_s32")
    net.write_source(alice, "game", "clamp_s32", "s32 clamp_s32(s32 v) {\n    return v < 0 ? 0 : v;\n}\n")
    fn = net._function("clamp_s32", "game")
    assert fn["status"] == "reconstructed"
    code = (tmp_path / "game" / "recovered" / "src" / "game" / "clamp_s32.c").read_text(encoding="utf-8")
    assert "return v < 0 ? 0 : v;" in code
    assert net.store.one("SELECT COUNT(*) AS n FROM claims WHERE function_id=?", fn["id"])["n"] == 0

    tree = net.sources("game")
    assert tree["kind"] == "rom"
    assert [f["path"] for f in tree["files"]] == ["src/game/clamp_s32.c"]
    assert tree["files"][0]["state"] == "reconstructed" and tree["files"][0]["agent"] == "alice"
    assert tree["counts"]["matches"] == 1 and tree["counts"]["reconstructed"] == 1
    assert tree["counts"]["pending"] == 1 and tree["counts"]["total"] == 3

    one = net.source_file("game", "src/game/clamp_s32.c")
    assert one["state"] == "reconstructed" and not one["verified"] and "clamp_s32" in one["source"]
    detail = net.function_detail("game", "clamp_s32")
    assert detail["source_kind"] == "reconstructed" and "return v < 0" in detail["source"]


def test_a_reconstruction_is_never_counted_as_a_match(game):
    net, alice = game
    claim(net, alice, "game", "clamp_s32")
    net.write_source(alice, "game", "clamp_s32", "s32 clamp_s32(s32 v) { return v; }\n")
    ov = net.overview("game")
    assert ov["matched"] == 1  # only the function that really matches
    assert ov["reconstruction"]["reconstructed"] == 1 and ov["reconstruction"]["matches"] == 1
    assert ov["reconstruction"]["pending"] == 1


def test_matched_code_is_not_reconstructed(game):
    net, alice = game
    claim(net, alice, "game", "matched_one")
    with pytest.raises(NetworkError, match="already matches"):
        net.write_source(alice, "game", "matched_one", "s32 matched_one(void) { return 0; }\n")


def test_you_need_the_claim(game):
    net, alice = game
    with pytest.raises(NetworkError, match="don't hold a claim"):
        net.write_source(alice, "game", "abs_s32", "s32 abs_s32(s32 v) { return v < 0 ? -v : v; }\n")


def test_export_keeps_verified_and_unverified_apart(game, tmp_path):
    net, alice = game
    claim(net, alice, "game", "clamp_s32")
    net.write_source(alice, "game", "clamp_s32", "s32 clamp_s32(s32 v) { return v < 0 ? 0 : v; }\n")
    out = net.export_sources("game", log=lambda *_: None)
    assert out["files"] == 1 and out["verified"] == 1 and out["unverified"] == 1 and out["pending"] == 1
    with zipfile.ZipFile(out["zip"]) as zf:
        assert "src/game/clamp_s32.c" in zf.namelist()
        report = zf.read("RECONSTRUCTION.md").decode("utf-8")
    assert "matched byte for byte, in the project's own source tree): 1" in report
    assert "reconstructed by agents (unverified, in this tree): 1" in report
    assert "`src/game/clamp_s32.c` — reconstructed by an agent (unverified) by alice" in report
    assert "## Still without code (first 200)" in report and "`abs_s32`" in report


def test_write_source_reaches_matching_projects_but_not_forks():
    assert "write_source" in tools.tool_names()
    assert "write_source" in tools.tool_names(analysis=True)
    assert "write_source" not in tools.tool_names(fork=True)


BINARY_CFG = {"kind": "analysis", "platform": "rea", "provider": "",
              "target": {"path": "game.exe", "tool": "open_binary", "format": "PE", "kind": "executable"},
              "counts": {"procedures": 2}, "artifact": None}


@pytest.fixture
def binary(tmp_path, monkeypatch):
    """An analyzed binary: two procedures and a task, with no REA server running."""
    from decompnet import rea

    def no_rea(target, provider=""):
        raise rea.ReaError("REA isn't running")

    monkeypatch.setattr(rea, "analysis_client", no_rea)
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    add_project(net, tmp_path, "bin", BINARY_CFG, [
        ("sub_401000", "open", ".text", {"kind": "procedure", "address": 0x401000}),
        ("sub_402000", "open", ".text", {"kind": "procedure", "address": 0x402000}),
        ("player-update", "open", "", {"kind": "task", "brief": "the player update path"}),
    ])
    return net, net.authenticate(net.register_agent("alice"))


def test_an_analyzed_binary_reconstructs_a_procedure(binary, tmp_path):
    net, alice = binary
    brief = net.claim(alice, "bin", "sub_401000")
    assert "write_source" in brief  # no byte-exact reference exists for this target
    text = net.write_source(alice, "bin", "sub_401000", "int sub_401000(int x) {\n    return x + 1;\n}\n")
    assert "functions/sub_401000.c is saved in recovered/" in text
    code = (tmp_path / "bin" / "recovered" / "functions" / "sub_401000.c").read_text(encoding="utf-8")
    assert code == "int sub_401000(int x) {\n    return x + 1;\n}\n"

    fn = net._function("sub_401000", "bin")
    meta = json.loads(fn["meta"])
    assert fn["status"] == "matched" and fn["matched_source"] is None  # code is not a finding
    assert meta["reconstructed"] is True and meta["path"] == "functions/sub_401000.c"

    tree = net.sources("bin")
    assert tree["tier"] == "binary" and tree["files"][0]["state"] == "reconstructed"
    assert tree["counts"]["reconstructed"] == 1 and tree["counts"]["total"] == 3
    assert tree["counts"]["pending"] == 2  # the work items still without recovered code
    assert net.source_file("bin", "functions/sub_401000.c")["source"].startswith("int sub_401000")
    detail = net.function_detail("bin", "sub_401000")
    assert detail["source_kind"] == "reconstructed" and "return x + 1" in detail["source"]
    assert net.overview("bin")["analysis"]["reconstruction"]["reconstructed"] == 1

    summary = net.analysis_summary("bin")["markdown"]
    assert "this target was analyzed, not matched" in summary
    assert "reconstructed code: `functions/sub_401000.c` (unverified)" in summary
    out = net.export_sources("bin", log=lambda *_: None)
    assert out["verified"] == 0 and out["pending"] == 2  # what the report says, what the caller gets
    with zipfile.ZipFile(out["zip"]) as zf:
        assert "functions/sub_401000.c" in zf.namelist()
        report = zf.read("RECONSTRUCTION.md").decode("utf-8")
    assert "- verified: none" in report and "reconstructed by agents (unverified): 1" in report
    assert "still without code: 2" in report
    assert "## Still without code (first 200)" in report
    assert "`sub_402000` at 0x402000" in report and "`player-update`" in report


def test_an_older_binary_project_gets_its_tier_worked_out(binary):
    """A binary imported before binaries had a Sources tier: the page still gets counts, not nothing."""
    net, _alice = binary
    rec = net.overview("bin")["analysis"]["reconstruction"]
    assert rec["tier"] == "binary" and rec["reconstructed"] == 0
    assert rec["total"] == 3 and rec["pending"] == 3
    stored = json.loads(net.store.one("SELECT config FROM projects WHERE slug='bin'")["config"])
    assert stored["reconstruction"]["tier"] == "binary"


class BinaryClient:
    def call(self, tool, arguments=None, timeout=None, *, any_tool=False, envelope=False):
        if tool == "binary_overview":
            return {"procedure_count": 2, "segment_count": 1}
        if tool == "list_segments":
            return {"segments": [{"name": ".text", "start": 0x401000, "end": 0x403000, "executable": True}]}
        if tool == "list_procedures":
            return {"procedures": [{"address": 0x401000, "name": "sub_401000"},
                                   {"address": 0x402000, "name": "sub_402000"}]}
        raise AssertionError(f"unexpected REA tool {tool}")


def test_a_binary_import_starts_with_an_empty_sources_tier(tmp_path, monkeypatch):
    """No source map, no archive: the Sources panel shows from the start that nothing is reconstructed yet."""
    from decompnet import rea

    exe = tmp_path / "game.exe"
    exe.write_bytes(b"MZ" + b"\0" * 62)
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        BinaryClient(), {"result": {"path": target["path"], "format": "PE", "architecture": "x86",
                                    "kind": "executable", "size": 64}}))
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    slug = net.import_analysis(exe, confirmed=True, log=lambda *_: None)

    rec = net.overview(slug)["analysis"]["reconstruction"]
    assert rec["tier"] == "binary" and rec["reconstructed"] == 0
    assert rec["total"] == 2 and rec["pending"] == 2
    tree = net.sources(slug)
    assert tree["tier"] == "binary" and tree["files"] == [] and tree["counts"]["pending"] == 2


def test_a_finding_survives_reconstruction(binary):
    """Code is saved next to the finding, not on top of it."""
    net, alice = binary
    net.claim(alice, "bin", "sub_402000")
    net.complete_analysis(alice, "bin", "sub_402000", "reads the player struct and clocks the update")
    claim(net, alice, "bin", "sub_402000")
    net.write_source(alice, "bin", "sub_402000", "void sub_402000(void) {\n}\n")
    fn = net._function("sub_402000", "bin")
    assert fn["matched_source"] == "reads the player struct and clocks the update"
    assert "void sub_402000" in fn["best_source"]
    assert net.source_file("bin", "functions/sub_402000.c")["source"].startswith("void sub_402000")


def test_a_task_is_reconstructed_into_tasks(binary, tmp_path):
    net, alice = binary
    claim(net, alice, "bin", "player-update")
    net.write_source(alice, "bin", "player-update", "void player_update(void) {\n}\n")
    assert (tmp_path / "bin" / "recovered" / "tasks" / "player-update.c").is_file()
    assert net.sources("bin")["counts"]["reconstructed"] == 1


class ArchiveClient:
    def __init__(self, target, inventory):
        self.target = target
        self.inventory = inventory

    def call(self, tool, arguments=None, timeout=None, *, any_tool=False, envelope=False):
        if tool == "inspect_artifact":
            return self.inventory
        if tool in ("binary_overview", "list_segments", "list_procedures"):
            return {}
        raise AssertionError(f"unexpected REA tool {tool}")


def archive_inventory(files):
    nodes = [{"artifact_id": "root", "format": "zip", "sha256": "a" * 64, "size": 400}]
    occurrences = [{"occurrence_id": "root-occ", "artifact_id": "root", "parent_occurrence_id": None,
                    "logical_path": ".", "entry_kind": "file", "artifact_kind": "container",
                    "artifact_format": "zip", "declared_size": 400}]
    for name, size in files:
        nodes.append({"artifact_id": name, "format": "file", "sha256": "b" * 64, "size": size})
        occurrences.append({"occurrence_id": name, "artifact_id": name, "parent_occurrence_id": "root-occ",
                            "logical_path": name, "entry_kind": "file", "artifact_kind": "file",
                            "artifact_format": "file", "declared_size": size})
    return {"inspection_id": "ai_test", "nodes": nodes, "occurrences": occurrences}


def make_archive(tmp_path):
    """A ZIP with code that shipped as text, a compiled entry, and files that stay ordinary work items."""
    archive = tmp_path / "app.zip"
    files = {"src/main.py": 'print("hi")\n', "src/readme.txt": "docs\n",
             "bin/app.pyc": b"\x00\x01\x02binary", "assets/logo.png": b"\x89PNG\r\n\x1a\n"}
    with zipfile.ZipFile(archive, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    inventory = archive_inventory([(name, len(content)) for name, content in files.items()])
    target = {"path": None}

    def open_analysis(target_path, provider=""):
        target["path"] = target_path["path"]
        return (ArchiveClient(target_path, inventory),
                {"result": {"path": target_path["path"], "format": "ZIP", "kind": "archive"}})

    return archive, open_analysis, files, target


def test_an_archive_hands_back_its_code(tmp_path, monkeypatch):
    """Text source comes out exactly (verified); compiled entries become reconstruction work."""
    from decompnet import rea

    archive, open_analysis, files, _target = make_archive(tmp_path)
    monkeypatch.setattr(rea, "open_analysis", open_analysis)
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    slug = net.import_analysis(archive, confirmed=True, log=lambda *_: None)

    rows = {row["name"]: row for row in net.store.all("SELECT name, status, meta FROM functions WHERE project_id=?",
                                                       net._project(slug)["id"])}
    assert rows["src/main.py"]["status"] == "matched"
    assert json.loads(rows["src/main.py"]["meta"])["origin"] == "archive"
    assert (tmp_path / "home" / slug / "recovered" / "src" / "main.py").read_text(encoding="utf-8") == files["src/main.py"]
    assert rows["bin/app.pyc"]["status"] == "open"
    assert json.loads(rows["bin/app.pyc"]["meta"])["kind"] == "reconstruction"
    assert json.loads(rows["bin/app.pyc"]["meta"])["entry_format"] == "Python bytecode"
    assert json.loads(rows["src/readme.txt"]["meta"])["kind"] == "artifact-entry"
    assert json.loads(rows["assets/logo.png"]["meta"])["kind"] == "artifact-entry"

    tree = net.sources(slug)
    assert tree["counts"]["recovered"] == 1 and tree["counts"]["pending"] == 1
    by_path = {f["path"]: f for f in tree["files"]}
    assert by_path["src/main.py"]["state"] == "verified" and by_path["bin/app.pyc"]["state"] == "pending"
    reconstruction = net.overview(slug)["analysis"]["reconstruction"]  # what makes the Sources panel show
    assert reconstruction["recovered"] == 1 and reconstruction["pending"] == 1
    summary = net.analysis_summary(slug)["markdown"]
    assert "## Sources" in summary and "1 extracted from the archive" in summary

    contents = {n["path"] for n in flatten(net.analysis_contents(slug)["nodes"]) if n["kind"] == "file"}
    assert contents == set(files)

    agent = net.authenticate(net.register_agent("alice"))
    brief = net.claim(agent, slug, "bin/app.pyc")
    assert "archive entry to reconstruct: bin/app.pyc" in brief and "write_source" in brief
    net.write_source(agent, slug, "bin/app.pyc", "def main():\n    print('hi')\n")
    recovered = (tmp_path / "home" / slug / "recovered" / "bin" / "app.py")
    assert recovered.read_text(encoding="utf-8") == "def main():\n    print('hi')\n"
    tree = net.sources(slug)
    assert tree["counts"]["reconstructed"] == 1 and tree["counts"]["pending"] == 0
    assert net.source_file(slug, "bin/app.py")["state"] == "reconstructed"

    out = net.export_sources(slug, log=lambda *_: None)
    with zipfile.ZipFile(out["zip"]) as zf:
        assert {"src/main.py", "bin/app.py"} <= set(zf.namelist())
        report = zf.read("RECONSTRUCTION.md").decode("utf-8")
    assert "verified (extracted from the archive, byte for byte): 1" in report
    assert "`src/main.py` — extracted from the archive, byte for byte" in report
    assert "`bin/app.py` — reconstructed by an agent (unverified) by alice" in report


def flatten(nodes):
    for node in nodes:
        yield node
        yield from flatten(node.get("children") or [])


def test_source_entries_are_classified_and_decoded():
    from decompnet.app import analysis

    assert analysis.source_language("src/main.py") == "Python"
    assert analysis.source_language("web/app.tsx") == "TypeScript"
    assert analysis.source_language("readme.txt") is None
    assert analysis.compiled_language("bin/app.class") == "Java bytecode"
    assert analysis.compiled_language("bin/app.pyc") == "Python bytecode"
    assert analysis.decode_source(b'print("hi")\n') == 'print("hi")\n'
    assert analysis.decode_source(b"\x00\x01binary") is None
    assert analysis.decode_source(b"\xff\xfe") is None


def test_the_gui_serves_reconstructed_code(tmp_path):
    """The routes the GUI calls: the Sources tree, one file, and the export job."""
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home / ".decomp")
    add_project(net, home, "game", GAME_CFG, [
        ("clamp_s32", "open", "src/game", {"kind": "procedure"}),
        ("abs_s32", "open", "src/game", {"kind": "procedure"}),
    ])
    alice = net.authenticate(net.register_agent("alice"))
    claim(net, alice, "game", "clamp_s32")
    net.write_source(alice, "game", "clamp_s32", "s32 clamp_s32(s32 v) { return v < 0 ? 0 : v; }\n")
    mcp, _manager, security = build(net, home / ".decomp", 6497, "s3cret")
    client = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                        base_url="http://127.0.0.1:6497")
    client.cookies.set("decomp_live", "s3cret")

    tree = client.get("/api/sources?slug=game").json()
    assert tree["kind"] == "rom" and tree["files"][0]["path"] == "src/game/clamp_s32.c"
    one = client.get("/api/sources/file", params={"slug": "game", "path": "src/game/clamp_s32.c"}).json()
    assert one["state"] == "reconstructed" and "clamp_s32" in one["source"]
    assert client.get("/api/project?slug=game").json()["reconstruction"]["reconstructed"] == 1

    started = client.post("/api/sources/export", json={"slug": "game"}, headers={"x-decomp": "1"}).json()
    for _ in range(200):
        job = client.get("/api/job", params={"id": started["job"]}).json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    assert job["result"]["files"] == 1 and job["result"]["unverified"] == 1


def test_the_gui_shows_a_binaries_sources_tier(binary, tmp_path):
    """What the page polls: an analyzed binary has a Sources tier (empty at first), then reconstructed files."""
    net, alice = binary
    home = tmp_path / "home"
    home.mkdir(parents=True, exist_ok=True)
    mcp, _manager, security = build(net, home, 6497, "s3cret")
    client = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                        base_url="http://127.0.0.1:6497")
    client.cookies.set("decomp_live", "s3cret")

    overview = client.get("/api/live", params={"slug": "bin"}).json()["overview"]
    rec = overview["analysis"]["reconstruction"]
    assert rec["tier"] == "binary" and rec["total"] == 3 and rec["pending"] == 3
    empty = client.get("/api/sources", params={"slug": "bin"}).json()
    assert empty["tier"] == "binary" and empty["files"] == [] and empty["counts"]["pending"] == 3

    claim(net, alice, "bin", "sub_401000")
    net.write_source(alice, "bin", "sub_401000", "int sub_401000(int x) {\n    return x + 1;\n}\n")
    tree = client.get("/api/sources", params={"slug": "bin"}).json()
    assert tree["files"][0]["path"] == "functions/sub_401000.c"
    assert tree["files"][0]["state"] == "reconstructed" and tree["counts"]["pending"] == 2
    one = client.get("/api/sources/file", params={"slug": "bin", "path": "functions/sub_401000.c"}).json()
    assert one["state"] == "reconstructed" and "return x + 1" in one["source"]


def test_reconstruction_projects_still_work(tmp_path):
    """The app-project path is unchanged: a module becomes analyzed and stays unverified."""
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    add_project(net, tmp_path, "app", {"kind": "analysis"}, [
        ("src/main.js", "open", "src", {"kind": "reconstruction", "path": "src/main.js"}),
    ])
    alice = net.authenticate(net.register_agent("alice"))
    claim(net, alice, "app", "src/main.js")
    net.write_source(alice, "app", "src/main.js", "console.log('hi');\n")
    tree = net.sources("app")
    assert tree["kind"] == "analysis" and tree["counts"]["reconstructed"] == 1
    assert (tmp_path / "app" / "recovered" / "src" / "main.js").read_text(encoding="utf-8") == "console.log('hi');\n"
    assert net.source_file("app", "src/main.js")["state"] == "reconstructed"
