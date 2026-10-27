"""Version-to-version comparison for PC programs: same, changed, added and removed functions."""

import shutil
import subprocess
from pathlib import Path

import pytest

from decompnet.rom import bincompare

CC = shutil.which("gcc")
pytestmark = pytest.mark.skipif(CC is None, reason="needs gcc")


def _build(work: Path, name: str, source: str) -> Path:
    src = work / f"{name}.c"
    src.write_text(source)
    exe = work / name
    subprocess.run([CC, "-O0", "-fno-inline", "-no-pie", "-o", str(exe), str(src)], check=True)
    return exe


def test_same_changed_added_and_removed(tmp_path):
    old = _build(tmp_path, "old", """
int add(int a, int b) { return a + b; }
int bump(int n) { return n + 1; }
int gone(int n) { return n * 3; }
int main(void) { return add(1, 2) + bump(3); }
""")
    new = _build(tmp_path, "new", """
int pad(int n) { return n * 7; }
int add(int a, int b) { return a + b; }
int bump(int n) { return n + 2; }
int fresh(int n) { return n - 1; }
int main(void) { return add(1, 2) + bump(3) + fresh(4); }
""")
    report = bincompare.compare_paths(old, new)
    rows = {r["name"]: r for r in report["rows"] if r["name"]}
    assert rows["add"]["status"] == "same"
    # The same code now lives at another address: still a match, and the move is counted.
    assert report["summary"]["moved"] >= 1
    assert rows["bump"]["status"] == "changed" and 0 < rows["bump"]["similarity"] < 1
    assert rows["gone"]["status"] == "removed"
    assert any(r["other_name"] == "fresh" and r["status"] == "added" for r in report["rows"])
    assert report["summary"]["same"] >= 1 and report["summary"]["changed"] >= 1


def test_old_project_names_are_used(tmp_path):
    old = _build(tmp_path, "old", "int add(int a, int b) { return a + b; }\nint main(void) { return add(1, 2); }\n")
    new = _build(tmp_path, "new", "int add(int a, int b) { return a + b; }\nint main(void) { return add(1, 2); }\n")
    report = bincompare.compare_paths(old, new)
    add = next(r for r in report["rows"] if r["name"] == "add")
    report = bincompare.compare_paths(old, new, old_names={add["address"]: "renamed_add"})
    assert any(r["name"] == "renamed_add" and r["status"] == "same" for r in report["rows"])


def test_rejects_non_pc_inputs(tmp_path):
    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"not a program")
    with pytest.raises(bincompare.CompareError, match="isn't a Windows PE or Linux"):
        bincompare.compare_paths(junk, junk)
