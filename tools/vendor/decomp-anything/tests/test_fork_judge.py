"""What counts as a match in a fork, and what may never block one.

The original object here is what a split of the game gives (dtk, splat): its literals carry the original's names
and sit where the whole file put them (lbl_80012348 behind constants of functions nobody has decompiled yet),
while the compiler names the decompiled function's literals itself and starts them at 0. objdiff's progress report
counts such a function as matched; every judgement in decomp.wtf has to agree, or a function reads 99.9% forever
and the guards reject every change next to it.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from decompnet import toolchains
from decompnet.app.engine import RomNetwork

pytestmark = pytest.mark.skipif(
    toolchains.installed("gcc-2.7.2-kmc") is None or toolchains.installed("objdiff-cli") is None
    or not shutil.which("git"), reason="needs gcc-2.7.2-kmc, objdiff-cli and git")

TARGET = """\
	.set noreorder
	.set noat
	.section .rodata
	.align 3
	.word 0x40000000, 0
	.globl lbl_80012348
lbl_80012348:
	.word 0x3FF19999, 0x9999999A
	.globl lbl_80012350
lbl_80012350:
	.word 0x40019999, 0x9999999A
	.text
	.align 2
	.globl offset
	.type offset,@function
	.ent offset
offset:
	lui $at, %hi(lbl_80012350)
	ldc1 $f0, %lo(lbl_80012350)($at)
	jr $ra
	add.d $f0, $f12, $f0
	.end offset
.Lfe1:
	.size offset,.Lfe1-offset
	.globl scale
	.type scale,@function
	.ent scale
scale:
	lui $at, %hi(lbl_80012348)
	ldc1 $f0, %lo(lbl_80012348)($at)
	jr $ra
	mul.d $f0, $f12, $f0
	.end scale
.Lfe2:
	.size scale,.Lfe2-scale
	.globl read_gain
	.type read_gain,@function
	.ent read_gain
read_gain:
	lui $at, %hi(gGain)
	jr $ra
	lwc1 $f0, %lo(gGain)($at)
	.end read_gain
.Lfe3:
	.size read_gain,.Lfe3-read_gain
"""

OFFSET = "double offset(double x) {\n    return x + 2.2;\n}\n"
SCALE = "double scale(double x) {\n    return x * 1.1;\n}\n"
GAIN = "float read_gain(void) {\n    return gVolume;\n}\n"


def _run(cwd: Path, *argv: str) -> None:
    subprocess.run(argv, cwd=cwd, check=True, capture_output=True,
                   env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin", "HOME": str(cwd)})


@pytest.fixture
def fork(tmp_path):
    tc = toolchains.require("gcc-2.7.2-kmc")
    repo = tmp_path / "upstream"
    (repo / "src").mkdir(parents=True)
    (repo / "include").mkdir()
    (repo / "expected").mkdir()
    (repo / "include" / "lit.h").write_text("extern float gVolume;\n")
    (repo / "src" / "lit.c").write_text('#include "lit.h"\n\n' + OFFSET)
    (repo / "expected" / "target.s").write_text(TARGET)
    _run(repo, str(tc / "as"), "-mips3", "-EB", "-o", "expected/lit.o", "expected/target.s")
    (repo / "build.ninja").write_text(
        f"rule cc\n  command = {tc}/gcc -B{tc}/ -c -G0 -mips3 -mgp32 -mfp32 -O2 -Iinclude $in -o $out\n"
        "build build/lit.o: cc src/lit.c | include/lit.h\n")
    (repo / "objdiff.json").write_text(json.dumps({"custom_make": "ninja", "units": [
        {"name": "lit", "target_path": "expected/lit.o", "base_path": "build/lit.o",
         "metadata": {"source_path": "src/lit.c", "complete": False}}]}))
    (repo / ".gitignore").write_text("build/\n")
    _run(repo, "git", "init", "-q", "-b", "main")
    _run(repo, "git", "add", "-A")
    _run(repo, "git", "commit", "-q", "-m", "initial")
    (tmp_path / "work").mkdir()
    net = RomNetwork(tmp_path / "app.db", tmp_path / "work")
    slug = net.forks.clone(str(repo), name="Literals", platform="n64", log=lambda *_: None)
    net.forks.get(slug)[1].build_all()
    net.forks.check(slug, log=lambda *_: None)
    agent, _ = net.local_agent("agent-1")
    return net, slug, agent


def _status(net, slug, name):
    return net._function(name, slug)["status"]


def test_a_literal_named_and_placed_differently_matches(fork):
    net, slug, agent = fork
    assert _status(net, slug, "offset") == "matched"  # the progress report's verdict
    out = net.compile_and_diff(agent, "scale", SCALE, slug)
    assert out.startswith("✅ MATCH"), out
    assert _status(net, slug, "scale") == "matched" and _status(net, slug, "offset") == "matched"


def test_resubmitting_a_matched_function_is_never_rejected(fork):
    net, slug, agent = fork
    out = net.compile_and_diff(agent, "offset", OFFSET, slug)
    assert "still matches" in out, out


def test_a_wrong_constant_is_not_a_match(fork):
    net, slug, agent = fork
    out = net.compile_and_diff(agent, "scale", SCALE.replace("1.1", "1.2"), slug)
    assert not out.startswith("✅") and "constants" in out and "1.1" in out and "1.2" in out, out
    assert _status(net, slug, "scale") == "open"
    net.forks.sync(slug, log=lambda *_: None)  # objdiff's report counts it; decomp.wtf still doesn't
    assert _status(net, slug, "scale") == "open"
    out = net.compile_and_diff(agent, "scale", SCALE, slug)
    assert out.startswith("✅ MATCH"), out
    net.forks.sync(slug, log=lambda *_: None)
    assert _status(net, slug, "scale") == "matched"


def test_a_reference_by_another_name_matches_with_a_warning(fork):
    net, slug, agent = fork
    out = net.compile_and_diff(agent, "read_gain", GAIN, slug)
    assert out.startswith("✅ MATCH") and "gGain" in out and "gVolume" in out, out


def test_a_stale_match_in_the_database_blocks_nothing(fork):
    net, slug, agent = fork
    pid = net.project_row(slug)["id"]
    with net.store.tx() as db:  # e.g. measured matched by an older build, or before an edit outside decomp.wtf
        db.execute("UPDATE functions SET status='matched' WHERE project_id=? AND name='scale'", (pid,))
    out = net.compile_and_diff(agent, "read_gain", GAIN, slug)
    assert out.startswith("✅ MATCH"), out
    assert _status(net, slug, "scale") == "open"  # the database follows the source tree again


def test_an_edit_that_breaks_the_build_is_undone(fork):
    net, slug, agent = fork
    path = Path(net.project_row(slug)["root"]) / "src" / "lit.c"
    before = path.read_text()
    out = net.forks.edit_file(agent, slug, "src/lit.c", "", "int broken = ;", "oops")
    assert out.startswith("❌") and "compile" in out, out
    assert path.read_text() == before
    out = net.forks.edit_file(agent, slug, "include/lit.h", "", "typedef int;\nint broken = ;", "oops")
    assert out.startswith("❌") and "compile" in out, out
    assert _status(net, slug, "offset") == "matched"
    out = net.forks.edit_file(agent, slug, "src/lit.c", "", "/* a note */", "a comment")
    assert out.startswith("✅"), out
    assert _status(net, slug, "offset") == "matched"


def test_a_match_made_with_edit_file_is_a_match_like_any_other(fork):
    net, slug, agent = fork
    out = net.forks.edit_file(agent, slug, "src/lit.c", "", SCALE, "write scale")
    assert out.startswith("✅"), out
    fn = net._function("scale", slug)
    assert fn["status"] == "matched" and fn["matched_agent_id"] == agent.id and fn["matched_at"]
    assert "1.1" in fn["matched_source"] and "offset" not in fn["matched_source"]
    assert net.store.one("SELECT 1 FROM events WHERE kind='match' AND detail='scale' AND agent_id=?", agent.id)
    assert net.stats(slug)["agents"][0]["matched"] >= 1


def test_edit_file_forgives_whitespace_and_shows_where_the_text_went(fork):
    net, slug, agent = fork
    path = Path(net.project_row(slug)["root"]) / "src" / "lit.c"
    out = net.forks.edit_file(agent, slug, "src/lit.c", "double offset(double x) {\n  return x + 2.2;",
                              "double offset(double x) {\n    /* tidied */\n    return x + 2.2;", "comment")
    assert out.startswith("✅") and "/* tidied */" in path.read_text(), out
    with pytest.raises(Exception) as e:
        net.forks.edit_file(agent, slug, "src/lit.c", "double ofset(double y) {\n    return y + 2.2;", "", "x")
    assert "closest" in str(e.value) and "double offset(double x)" in str(e.value)


def test_lines_the_file_already_has_may_come_along(fork):
    """Includes and declarations sent with a function are placed in its file (agents' prototypes and pragma
    wrappers came back as errors before, a wasted turn each); a struct or a global still goes in with edit_file."""
    net, slug, agent = fork
    out = net.compile_and_diff(agent, "scale", '#include "lit.h"\n\n' + SCALE, slug)
    assert out.startswith("✅ MATCH"), out
    root = Path(net.project_row(slug)["root"])
    net.compile_and_diff(agent, "read_gain", "extern float gGain;\n" + GAIN, slug)
    text = next(p.read_text() for p in (root / "src").rglob("*.c") if "read_gain" in p.read_text())
    assert text.index("extern float gGain;") < text.index("float read_gain(")
    with pytest.raises(Exception) as e:
        net.compile_and_diff(agent, "read_gain", "struct Gain { float v; };\n" + GAIN, slug)
    assert "struct Gain" in str(e.value) and "edit_file" in str(e.value)
