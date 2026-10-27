"""Archive analysis helpers: the inventory shape REA returns, its regular-file work items, and bounded reads."""

import json
import zipfile
from pathlib import Path

import pytest

from decompnet.app import analysis

ZIP = Path(__file__).parent / "fixtures" / "artifact-demo.zip"


def inventory():
    return {
        "inspection_id": "ai_test",
        "nodes": [
            {"artifact_id": "root", "format": "zip", "sha256": "a" * 64, "size": 452, "content_state": "materialized"},
            {"artifact_id": "file", "format": "file", "sha256": "b" * 64, "size": 5, "content_state": "embedded"},
        ],
        "occurrences": [
            {"occurrence_id": "root-occ", "artifact_id": "root", "parent_occurrence_id": None,
             "logical_path": ".", "entry_kind": "file", "artifact_kind": "container", "artifact_format": "zip",
             "declared_size": 452, "executable": False, "encrypted": False},
            {"occurrence_id": "file-occ", "artifact_id": "file", "parent_occurrence_id": "root-occ",
             "logical_path": "dir/a.txt", "entry_kind": "file", "artifact_kind": "resource",
             "artifact_format": "file", "declared_size": 5, "executable": False, "encrypted": False},
            {"occurrence_id": "dir-occ", "artifact_id": "root", "parent_occurrence_id": "root-occ",
             "logical_path": "dir", "entry_kind": "directory", "artifact_kind": "container",
             "artifact_format": "zip", "declared_size": None, "executable": True, "encrypted": False},
        ],
    }


def test_inventory_is_found_inside_the_inspect_artifact_envelope():
    inv = inventory()
    assert analysis.artifact_inventory({"substeps": [{"evidence": {"normalized_result": inv}}]}) is inv


def test_only_regular_files_become_work_items_with_inventory_facts():
    entries = analysis.artifact_entries(inventory())
    assert [(e["name"], e["unit"], e["size"], e["sha256"]) for e in entries] == [
        ("dir/a.txt", "dir", 5, "b" * 64),
    ]
    assert entries[0]["kind"] == "artifact-entry"


def test_archive_entries_are_read_without_extracting():
    assert analysis.read_archive_entry(ZIP, "dir/a.txt") == b"hello"
    assert analysis.read_archive_entry(ZIP, "b.bin", 1, 3) == b"orl"
    assert analysis.read_archive_entry(ZIP, "missing") is None
    assert analysis.preview_bytes(b"hello") == "hello"


def test_archive_suffixes_are_recognized():
    assert analysis.is_archive(ZIP)
    assert not analysis.is_archive(Path("game.z64"))


def test_entries_are_classified_from_magic_before_extension():
    assert analysis.classify_entry("firmware/tiny")["analyzable"] is False
    elf = analysis.classify_entry("firmware/tiny", b"\x7fELF" + b"\0" * 12)
    assert (elf["entry_type"], elf["entry_format"], elf["tool"]) == ("binary", "ELF", "open_binary")
    assert analysis.classify_entry("notes.txt")["entry_type"] == "text"
    assert analysis.classify_entry("bundle.apk")["entry_type"] == "android"
    assert analysis.classify_entry("app.asar")["tool"] == "analyze_javascript_application"
    assert analysis.classify_entry("bundle.js")["tool"] == "open_binary"  # one script is not an application


def test_one_entry_is_extracted_to_a_new_file(tmp_path):
    out = tmp_path / "extracted" / "a.txt"
    size, digest = analysis.extract_archive_entry(ZIP, "dir/a.txt", out)
    assert out.read_bytes() == b"hello"
    assert size == 5
    assert digest == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_extraction_cap_leaves_no_partial_file(tmp_path):
    out = tmp_path / "extracted" / "a.txt"
    with pytest.raises(ValueError, match="larger than"):
        analysis.extract_archive_entry(ZIP, "dir/a.txt", out, max_bytes=3)
    assert not out.exists()
    assert not (out.parent / "a.txt.part").exists()


def test_inventory_limits_reject_count_size_and_ratio(monkeypatch):
    monkeypatch.setattr(analysis, "MAX_INVENTORY_ENTRIES", 1)
    with pytest.raises(ValueError, match="entries"):
        analysis.validate_inventory(inventory())
    monkeypatch.setattr(analysis, "MAX_INVENTORY_ENTRIES", 100)
    monkeypatch.setattr(analysis, "MAX_INVENTORY_BYTES", 1)
    with pytest.raises(ValueError, match="total more"):
        analysis.validate_inventory(inventory())
    monkeypatch.setattr(analysis, "MAX_INVENTORY_BYTES", 1 << 30)
    monkeypatch.setattr(analysis, "MAX_COMPRESSION_RATIO", 1)
    inv = inventory()
    inv["occurrences"][1]["compressed_size"] = 1
    with pytest.raises(ValueError, match="compression ratio"):
        analysis.validate_inventory(inv)


def test_import_analysis_maps_archive_files_to_work_items(tmp_path, monkeypatch):
    from decompnet import rea
    from decompnet.app.engine import RomNetwork

    inv = inventory()

    class FakeClient:
        def call(self, tool, arguments=None, timeout=None, *, any_tool=False):
            if tool == "inspect_artifact":
                return {"substeps": [{"evidence": {"normalized_result": inv}}]}
            if tool in ("binary_overview", "list_segments", "list_procedures"):
                return {}
            raise AssertionError(tool)

    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(), {"result": {"path": target["path"], "format": "zip", "kind": "archive"}}))
    net = RomNetwork(tmp_path / "decomp.db", tmp_path)
    slug = net.import_analysis(ZIP, confirmed=True, log=lambda *_: None)
    proj = net.project_row(slug)
    assert proj["description"] == "zip · 3 entries · 1 work item"
    rows = net.store.all("SELECT name, size, meta FROM functions WHERE project_id=? ORDER BY name", proj["id"])
    assert [r["name"] for r in rows] == ["dir/a.txt"]
    assert rows[0]["size"] == 5
    assert '"kind": "artifact-entry"' in rows[0]["meta"]
    overview = net.overview(slug)
    assert (overview["entries"], overview["files"], overview["functions"]) == (3, 1, 1)
    contents = net.analysis_contents(slug)
    assert contents["nodes"][0]["name"] == "dir"
    assert contents["nodes"][0]["children"][0]["path"] == "dir/a.txt"
    assert "hello" in net.analysis_read_entry(slug, "dir/a.txt")
    with net.store.tx() as db:
        db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                   ("tiny-child", "tiny", "ELF · 1 work item", "x86_64", 0, str(tmp_path / "tiny-child"),
                    json.dumps({"kind": "analysis"})))
    net._update_cfg(slug, lambda c: c.__setitem__("children", [
        {"slug": "tiny-child", "title": "tiny", "entry": "dir/a.txt"}]))
    contents = net.analysis_contents(slug)
    assert contents["nodes"][0]["children"][0]["child"] == "tiny-child"
    work_map = net.function_map(slug)
    assert work_map[0]["child"] == "tiny-child"
    assert work_map[0]["kind"] == "artifact-entry"
    assert work_map[0]["path"] == "dir/a.txt"

    agent, _ = net.local_agent("archive-tester")
    net.claim(agent, slug)
    net.complete_analysis(agent, slug, "dir/a.txt", "A five-byte text file containing hello.")
    report = net.analysis_summary(slug)
    assert report["complete"] is True
    assert "A five-byte text file containing hello." in report["markdown"]
    assert Path(report["path"]).name == "SUMMARY.md"
    assert Path(report["path"]).exists()


def test_safe_rel_path_keeps_writes_inside_the_project():
    assert analysis.safe_rel_path("dir/a.c") == "dir/a.c"
    assert analysis.safe_rel_path("/etc/passwd") == "etc/passwd"
    assert analysis.safe_rel_path("C:\\Windows\\a.c") == "Windows/a.c"
    assert analysis.safe_rel_path("../escape.c") == ""
    assert analysis.safe_rel_path("dir/../../escape.c") == ""
    assert analysis.safe_rel_path(".") == "" and analysis.safe_rel_path("") == ""


def test_an_archive_entry_named_dotdot_never_writes_outside_the_project(tmp_path, monkeypatch):
    """Archive entries carry whatever name they were stored with. One called '../escape.c' is still a work item (the
    archive is read by that name) but must not decide where its recovered source file lands."""
    from decompnet import rea
    from decompnet.app.engine import RomNetwork

    archive = tmp_path / "parent.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("../escape.c", "int escaped(void) { return 1; }\n")
    inv = {
        "inspection_id": "ai_escape",
        "nodes": [{"artifact_id": "root", "format": "zip", "size": archive.stat().st_size},
                  {"artifact_id": "entry", "format": "file", "size": 34}],
        "occurrences": [
            {"occurrence_id": "root-occ", "artifact_id": "root", "parent_occurrence_id": None,
             "logical_path": ".", "entry_kind": "file", "artifact_format": "zip",
             "declared_size": archive.stat().st_size},
            {"occurrence_id": "entry-occ", "artifact_id": "entry", "parent_occurrence_id": "root-occ",
             "logical_path": "../escape.c", "entry_kind": "file", "artifact_format": "file", "declared_size": 34},
        ],
    }

    class FakeClient:
        def call(self, tool, arguments=None, timeout=None, *, any_tool=False):
            if tool == "inspect_artifact":
                return {"substeps": [{"evidence": {"normalized_result": inv}}]}
            if tool in ("binary_overview", "list_segments", "list_procedures"):
                return {}
            raise AssertionError(tool)

    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(), {"result": {"path": target["path"], "format": "zip", "kind": "archive"}}))
    home = tmp_path / "home"
    net = RomNetwork(tmp_path / "decomp.db", home)
    net.workspace.mkdir(parents=True)
    slug = net.import_analysis(archive, confirmed=True, log=lambda *_: None)
    assert not (home / "escape.c").exists() and not (tmp_path / "escape.c").exists()
    assert [r["name"] for r in net.store.all("SELECT name FROM functions WHERE project_id=?",
                                               net.project_row(slug)["id"])] == ["../escape.c"]
    assert "escaped" in net.store.one("SELECT matched_source FROM functions WHERE project_id=?",
                                       net.project_row(slug)["id"])["matched_source"]


def test_analyze_archive_entry_extracts_once_and_links_a_child(tmp_path, monkeypatch):
    from decompnet import rea
    from decompnet.app.engine import RomNetwork

    archive = tmp_path / "parent.zip"
    payload = b"\x7fELF" + b"\0" * 12
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("firmware/tiny.elf", payload)
    inv = {
        "inspection_id": "ai_child",
        "nodes": [
            {"artifact_id": "root", "format": "zip", "size": archive.stat().st_size},
            {"artifact_id": "entry", "format": "file", "size": len(payload)},
        ],
        "occurrences": [
            {"occurrence_id": "root-occ", "artifact_id": "root", "parent_occurrence_id": None,
             "logical_path": ".", "entry_kind": "file", "artifact_format": "zip",
             "declared_size": archive.stat().st_size},
            {"occurrence_id": "entry-occ", "artifact_id": "entry", "parent_occurrence_id": "root-occ",
             "logical_path": "firmware/tiny.elf", "entry_kind": "file", "artifact_format": "file",
             "declared_size": len(payload), "sha256": "", "executable": True},
        ],
    }

    class FakeClient:
        def call(self, tool, arguments=None, timeout=None, *, any_tool=False):
            if tool == "inspect_artifact":
                return {"substeps": [{"evidence": {"normalized_result": inv}}]}
            if tool in ("binary_overview", "list_segments", "list_procedures"):
                return {}
            raise AssertionError(tool)

    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(), {"result": {"path": target["path"], "format": "zip", "kind": "archive"}}))
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    net.workspace.mkdir(parents=True)
    parent = net.import_analysis(archive, confirmed=True, log=lambda *_: None)
    real_import = net.import_analysis
    calls = []

    def fake_import(path, **kwargs):
        calls.append((Path(path), kwargs))
        return real_import(path, **kwargs)

    monkeypatch.setattr(net, "import_analysis", fake_import)
    result = net.analyze_archive_entry(parent, "firmware/tiny.elf", log=lambda *_: None)
    child = result["slug"]
    assert result["existing"] is False
    assert len(calls) == 1
    assert calls[0][0].read_bytes() == payload

    parent_cfg = net.cfg(net._project(parent))
    assert parent_cfg["children"][0]["entry"] == "firmware/tiny.elf"
    assert parent_cfg["children"][0]["slug"] == child
    child_cfg = net.cfg(net._project(child))
    assert child_cfg["source"]["parent"] == parent
    assert child_cfg["source"]["entry"] == "firmware/tiny.elf"
    assert child_cfg["source"]["depth"] == 1
    assert "Nested targets" in (tmp_path / "home" / parent / "SUMMARY.md").read_text()

    again = net.analyze_archive_entry(parent, "firmware/tiny.elf", log=lambda *_: None)
    assert again == {"slug": child, "entry": "firmware/tiny.elf", "existing": True}
    assert len(calls) == 1
