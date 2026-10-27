"""The end of a decomp is a linked file: when the last function of a file matches, decomp.wtf marks it Matching in
configure.py, the game is built from the C and the project's checksum check must still pass; once linked, no change
may make the built game differ.

The project here is a dtk-template in miniature: configure.py lists objects as Matching/NonMatching and writes
build.ninja (which reruns it when it changes) and objdiff.json; the "game" is the code and data of each object the
link uses (the compiled one for a Matching file, the original's otherwise); build/ok checks it against game.sha1.
"""

import hashlib
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from decompnet import toolchains
from decompnet.app.engine import RomNetwork

pytestmark = pytest.mark.skipif(
    toolchains.installed("gcc-2.7.2-kmc") is None or toolchains.installed("objdiff-cli") is None
    or not shutil.which("git") or not shutil.which("ninja"), reason="needs gcc-2.7.2-kmc, objdiff-cli, git, ninja")

ADD = "int add(int a, int b) {\n    return a + b;\n}\n"
SUB = "int sub(int a, int b) {\n    return a - b;\n}\n"

CONFIGURE = '''\
import json, re, sys
from pathlib import Path

Matching, NonMatching = True, False


def Object(linked, src):
    return linked, src


objects = [
    Object(NonMatching, "math.c"),
]
'''

CONFIGURE_TAIL = '''
TC = sys.argv[1] if len(sys.argv) > 1 else "{tc}"
lines = [
    "rule configure", "  command = python3 configure.py", "  generator = 1",
    "build build.ninja: configure | configure.py",
    "rule cc", f"  command = {{TC}}/gcc -B{{TC}}/ -c -G0 -mips3 -mgp32 -mfp32 -O2 $in -o $out",
    "rule game", "  command = python3 link.py $out $in",
    "rule check", "  command = python3 check.py $in $out",
]
units, game = [], []
for linked, src in objects:
    stem = Path(src).stem
    lines.append(f"build build/src/{{stem}}.o: cc src/{{src}}")
    game.append(f"build/src/{{stem}}.o" if linked else f"expected/{{stem}}.o")
    units.append({{"name": stem, "target_path": f"expected/{{stem}}.o", "base_path": f"build/src/{{stem}}.o",
                  "metadata": {{"source_path": f"src/{{src}}", "complete": linked}}}})
lines += [f"build build/game.bin: game {{' '.join(game)}}", "build build/ok: check game.sha1 | build/game.bin",
          "build all_source: phony " + " ".join(f"build/src/{{Path(s).stem}}.o" for _, s in objects), ""]
Path("build.ninja").write_text("\\n".join(lines))
Path("objdiff.json").write_text(json.dumps({{"custom_make": "ninja", "units": units}}))
'''


LINK = '''\
import sys
from io import BytesIO
from elftools.elf.elffile import ELFFile
out = b""
for p in sys.argv[2:]:  # the code, then the data, of every object the link uses
    elf = ELFFile(BytesIO(open(p, "rb").read()))
    out += b"".join(elf.get_section_by_name(n).data() for n in (".text", ".rodata", ".data")
                    if elf.get_section_by_name(n) is not None)
open(sys.argv[1], "wb").write(out)
'''

CHECK = '''\
import hashlib, sys
want = open(sys.argv[1]).read().split()[0]
got = hashlib.sha1(open("build/game.bin", "rb").read()).hexdigest()
if got != want:
    sys.exit(f"build/game.bin: FAILED (sha1 {got}, expected {want})")
open(sys.argv[2], "w").write("ok\\n")
print("1 files OK")
'''


def _run(cwd: Path, *argv: str) -> None:
    subprocess.run(argv, cwd=cwd, check=True, capture_output=True,
                   env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin", "HOME": str(cwd)})


@pytest.fixture
def fork(tmp_path):
    tc = toolchains.require("gcc-2.7.2-kmc")
    repo = tmp_path / "upstream"
    (repo / "src").mkdir(parents=True)
    (repo / "expected").mkdir()
    (repo / "src" / "math.c").write_text(ADD)  # sub isn't decompiled yet
    (repo / "expected" / "math.c").write_text(ADD + "\n" + SUB)
    _run(repo, str(tc / "gcc"), f"-B{tc}/", "-c", "-G0", "-mips3", "-mgp32", "-mfp32", "-O2", "expected/math.c",
         "-o", "expected/math.o")
    (repo / "expected" / "math.c").unlink()
    (repo / "configure.py").write_text(CONFIGURE + CONFIGURE_TAIL.format(tc=tc))
    (repo / "link.py").write_text(LINK)
    (repo / "check.py").write_text(CHECK)
    _run(repo, sys.executable, "-c", LINK, "game.bin", "expected/math.o")
    (repo / "game.sha1").write_text(hashlib.sha1((repo / "game.bin").read_bytes()).hexdigest() + "  build/game.bin\n")
    (repo / "game.bin").unlink()
    (repo / ".gitignore").write_text("build/\nbuild.ninja\nobjdiff.json\n")
    _run(repo, "git", "init", "-q", "-b", "main")
    _run(repo, "git", "add", "-A")
    _run(repo, "git", "commit", "-q", "-m", "initial")
    (tmp_path / "work").mkdir()
    net = RomNetwork(tmp_path / "app.db", tmp_path / "work")
    slug = net.forks.clone(str(repo), name="Linking", platform="n64", log=lambda *_: None)
    fp = net.forks.get(slug)[1]
    assert fp.run(["python3", "configure.py"])[0]
    assert fp.build_all()[0] and fp.verify()[0]
    net.forks.check(slug, log=lambda *_: None)
    agent, _ = net.local_agent("agent-1")
    return net, slug, agent, fp


def _wait_linking(net, slug, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        state = net.forks._linking.get(slug)
        if state and not state["running"]:
            return
        time.sleep(0.1)
    raise AssertionError("linking didn't finish")


def test_the_last_match_of_a_file_links_it_into_the_game(fork):
    net, slug, agent, fp = fork
    assert fp.link_states()["src/math.c"][0] == "NonMatching"
    out = net.compile_and_diff(agent, "sub", SUB, slug)
    assert out.startswith("✅ MATCH") and "linking the file" in out, out
    _wait_linking(net, slug)
    assert fp.link_states()["src/math.c"][0] == "Matching"
    assert fp.unit("math").complete and fp.verify()[0]
    log = fp.git("log", "--format=%s", "-3")[1]
    assert "Link math.c" in log and "Match sub" in log, log
    assert fp.git("status", "--short", "configure.py")[1].strip() == ""
    assert net.store.one("SELECT 1 FROM events WHERE kind='link' AND detail='src/math.c'")
    assert net.forks.get(slug)[2]["measures"]["complete_code_percent"] == 100


def test_a_linked_file_must_keep_building_the_same_game(fork):
    net, slug, agent, fp = fork
    net.compile_and_diff(agent, "sub", SUB, slug)
    _wait_linking(net, slug)
    path = fp.root / "src" / "math.c"
    before = path.read_text()
    # every function still matches, but the game built from the file would have one more function in it
    out = net.forks.edit_file(agent, slug, "src/math.c", "", "int extra(void) {\n    return 0;\n}\n", "a helper")
    assert out.startswith("❌") and "byte for byte" in out and "FAILED" in out, out
    assert path.read_text() == before and fp.verify()[0]


def test_nothing_unfinished_is_linked(fork):
    net, slug, _agent, fp = fork
    res = net.forks.link(slug, log=lambda *_: None)
    assert res["linked"] == [] and fp.link_states()["src/math.c"][0] == "NonMatching"


def test_a_file_whose_data_differs_says_what_and_stays_unlinked(fork):
    net, slug, agent, fp = fork
    out = net.forks.edit_file(agent, slug, "src/math.c", "", "int gCount = 3;", "a global the original hasn't")
    assert out.startswith("✅"), out
    out = net.compile_and_diff(agent, "sub", SUB, slug)
    assert out.startswith("✅ MATCH") and "its data must match too" in out and "gCount" in out, out
    status = net.forks.file_status(slug, "src/math.c")
    assert "not linked yet" in status and "2/2 functions match" in status and "gCount" in status, status
    res = net.forks.link(slug, log=lambda *_: None)
    assert res["linked"] == [] and "FAILED" in res["failed"]["src/math.c"], res
    assert fp.link_states()["src/math.c"][0] == "NonMatching" and fp.verify()[0]
    assert "The last try to link it failed" in net.forks.file_status(slug, "src/math.c")
    assert net.forks.file_status(slug, "sub").startswith("## src/math.c")
