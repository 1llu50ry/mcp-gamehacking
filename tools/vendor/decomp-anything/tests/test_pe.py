"""Windows PE targets: reading functions out of an executable, and matching compiled C against them.

The fixture is built with the MinGW-w64 GCC already on the machine, so both sides are real compiler
output: the executable is split by decomp.wtf, the candidate is compiled by the same compiler with the
toolchain's flags, and the x86 matcher has to accept it byte for byte.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import capstone
import pytest

from decompnet import coffobj
from decompnet.app.engine import RomNetwork
from decompnet.rom import pe

CC = shutil.which("x86_64-w64-mingw32-gcc")
FLAGS = ["-O2", "-ffreestanding", "-ffunction-sections", "-fdata-sections", "-fno-asynchronous-unwind-tables",
         "-fno-unwind-tables", "-fno-stack-protector", "-fno-ident", "-fno-pic", "-fno-pie", "-mno-stack-arg-probe"]

pytestmark = pytest.mark.skipif(CC is None, reason="needs x86_64-w64-mingw32-gcc")
CXX = shutil.which("x86_64-w64-mingw32-g++")

SOURCE = r"""
__attribute__((noinline)) int add(int a, int b) { return a + b; }
__attribute__((noinline)) int mul3(int a) { return add(a, a) * 3; }
int g_counter;
__attribute__((noinline)) int bump(int n) { g_counter += n; return g_counter; }
__attribute__((noinline)) int twice(int n) { return mul3(n) + 1; }
void _start(void) { g_counter = bump(twice(2)); }
"""


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    work = tmp_path_factory.mktemp("pe")
    (work / "game.c").write_text(SOURCE)
    exe, obj = work / "game.exe", work / "game.o"
    subprocess.run([CC, *FLAGS, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(work / "game.c")], check=True)
    subprocess.run([CC, *FLAGS, "-c", "-o", str(obj), str(work / "game.c")], check=True)
    return exe, obj


def test_reads_functions_and_addresses(built):
    exe, _obj = built
    image = pe.read(exe.read_bytes(), "game.exe")
    assert image.arch == "x86_64" and image.pe32_plus
    names = {f.name for f in image.functions}
    assert {"add", "mul3", "bump", "twice", "_start"} <= names
    bump = next(f for f in image.functions if f.name == "bump")
    assert bump.vram == next(s.address for s in image.symbols if s.name == "bump")
    assert {r[1] for r in bump.refs} == {4}  # AMD64 REL32
    assert all(image.info["size"] > 0 for _ in [0])


def test_coff_relocations_point_at_named_symbols(built):
    _exe, obj = built
    fn = coffobj.extract_function(obj.read_bytes(), "bump")
    assert fn is not None and fn.arch == "x86_64" and len(fn.code) == 15
    assert [r.symbol for r in fn.relocs] == ["g_counter", "g_counter"]
    assert [r.offset for r in fn.relocs] == [2, 10]


def test_import_keeps_the_programs_name(built):
    """The project folder gets the name the user picked, not a generic game.exe."""
    exe, _obj = built
    named = exe.with_name("My Game.exe")
    shutil.copyfile(exe, named)
    net = RomNetwork(exe.parent / "name.db", exe.parent)
    slug = net.import_rom(named, confirmed=True, log=lambda *_: None)
    proj = net.store.one("SELECT * FROM projects WHERE slug=?", slug)
    root = Path(proj["root"])
    assert (root / "My Game.exe").is_file()
    assert json.loads(proj["config"])["rom"]["program"] == "My Game.exe"


def test_import_and_match_through_the_engine(built):
    exe, _obj = built
    net = RomNetwork(built[0].parent / "decomp.db", built[0].parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["platform"] == "windows" and ov["platform_name"] == "Windows"
    assert ov["functions"] >= 4 and ov["library"] >= 1 and ov["compiler"]["toolchain"] == "mingw-x86_64"
    assert ov["source_language"] == "C" and ov["source_ext"] == ".c"
    agent, _ = net.local_agent("windows-tester")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)
    assert "MATCH" in net.compile_and_diff(
        agent, "bump", "int g_counter;\nint bump(int n) { g_counter += n; return g_counter; }", slug)
    # A call to another function is a relocation too: the target's bytes say exactly which address.
    text = net.compile_and_diff(agent, "twice", "int mul3(int a);\nint twice(int n) { return mul3(n) + 1; }", slug)
    assert "MATCH" in text, text
    # A different constant is a real difference, not a relocation.
    text = net.compile_and_diff(agent, "add", "int add(int a, int b) { return a - b; }", slug)
    assert "MATCH" not in text
    assert "bytes differ" in text or "different" in text


def test_autopilot_says_x86_has_no_drafts(built):
    """m2c has no x86 target: autopilot still tries identical code, but it must say so rather than count every
    function as a draft it tried (and never made) as progress."""
    import time

    exe, _obj = built
    net = RomNetwork(exe.parent / "auto.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    net.start_autopilot(slug)
    st = net.autopilot_status(slug)
    for _ in range(300):
        st = net.autopilot_status(slug)
        if st["state"] != "running":
            break
        time.sleep(0.1)
    assert st["state"] == "done" and st["total"] == 0 and st["tried"] == 0 and st["done"] == 0
    assert "x86" in st["no_drafts"]


def test_the_same_program_is_not_parsed_twice(built, monkeypatch):
    exe, _obj = built
    net = RomNetwork(exe.parent / "same.db", exe.parent)
    data = exe.read_bytes()
    slug = net.import_rom(data, confirmed=True, name="game.exe", log=lambda *_: None)
    logs = []
    monkeypatch.setattr(pe, "read", lambda *a, **k: (_ for _ in ()).throw(AssertionError("parsed again")))
    again = net.import_rom(data, confirmed=True, name="game.exe", log=logs.append)
    assert again == slug and any("already imported" in line for line in logs)


def test_xrefs_use_relocations(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "x.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    proj = net.store.one("SELECT * FROM projects WHERE slug=?", slug)
    x = net.xrefs(proj)
    twice = net.store.one("SELECT * FROM functions WHERE project_id=? AND name='twice'", proj["id"])
    mul3 = net.store.one("SELECT * FROM functions WHERE project_id=? AND name='mul3'", proj["id"])
    assert mul3["vram"] in x["calls"].get(twice["vram"], set())


def test_import_requires_confirmation(built):
    from decompnet.network import NetworkError

    exe, _obj = built
    net = RomNetwork(exe.parent / "no.db", exe.parent)
    with pytest.raises(NetworkError, match="legally obtained"):
        net.import_rom(exe.read_bytes(), name="game.exe", log=lambda *_: None)


CC32 = shutil.which("i686-w64-mingw32-gcc")


@pytest.mark.skipif(CC32 is None, reason="needs i686-w64-mingw32-gcc")
def test_32_bit_functions_and_absolute_globals(tmp_path):
    src = tmp_path / "game32.c"
    src.write_text("int add(int a, int b) { return a + b; }\nint g_counter;\n"
                   "int bump(int n) { g_counter += n; return g_counter; }\n"
                   "void _start(void) { g_counter = bump(2); }\n")
    exe = tmp_path / "game32.exe"
    flags = [f for f in FLAGS if f not in ("-fno-pic", "-fno-pie")]
    subprocess.run([CC32, *flags, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    net = RomNetwork(tmp_path / "d.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), toolchain="mingw-x86_64", confirmed=True, name="game32.exe",
                          log=lambda *_: None)
    image = pe.read(exe.read_bytes(), "game32.exe")
    assert image.arch == "x86" and {f.name for f in image.functions} >= {"add", "bump"}
    assert net.overview(slug)["compiler"]["toolchain"] == "mingw-x86", "a 32-bit target must not compile with x86-64"
    agent, _ = net.local_agent("x86-tester")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)
    assert "MATCH" in net.compile_and_diff(
        agent, "bump", "int g_counter;\nint bump(int n) { g_counter += n; return g_counter; }", slug)


def test_walk_follows_branches_inside_one_function():
    """A 32-bit function's forward branch is another block, not the next function: walking its control flow
    reaches both rets (the old next-start splitter cut it at the branch target)."""
    code = bytes.fromhex("55 8b ec 74 03 31 c0 c3 b8 01 00 00 00 c3")
    md = pe._md("x86")
    md.detail = True
    md.skipdata = True
    assert pe._walk(code, 0x1000, 0x1000, {0x1000}, md) == 0x100E


def test_walk_stops_at_a_tail_called_function():
    code = bytes.fromhex("55 8b ec e9 08 00 00 00") + b"\xcc" * 0x18
    md = pe._md("x86")
    md.detail = True
    md.skipdata = True
    assert pe._walk(code, 0x1000, 0x1000, {0x1000, 0x1010}, md) == 0x1008


def test_alignment_fill_is_not_part_of_a_function():
    """A block that fell through into the next function's alignment fill must not keep it: GCC pads with
    `lea esi, [esi]` (even through the CS prefix) and nop, and neither compiles from C."""
    body = bytes.fromhex("8b 44 24 04 03 44 24 08 c3")
    assert pe._trim_padding(body + bytes.fromhex("8d b6 00 00 00 00 90"), "x86") == body
    assert pe._trim_padding(body + bytes.fromhex("2e 8d b4 26 00 00 00 00 66 90"), "x86") == body
    # A real `lea` (with a displacement or a different register) stays.
    rest = body + bytes.fromhex("8d 44 24 10 c3")
    assert pe._trim_padding(rest, "x86") == rest


@pytest.mark.skipif(CC32 is None, reason="needs i686-w64-mingw32-gcc")
def test_32_bit_branches_loops_and_function_pointers_are_whole_functions(tmp_path):
    """A function with if/else, a loop and a tail call is one function; one only reached through a
    function pointer is still found, and no fragment of another function is listed as its own."""
    src = tmp_path / "branches.c"
    src.write_text("int g_counter;\n"
                   "__attribute__((noinline)) int add(int a, int b) { return a + b; }\n"
                   "__attribute__((noinline)) int pick(int x) { if (x > 10) return add(x, 1); else return add(x, -1); }\n"
                   "__attribute__((noinline)) int loop(int n) { int s = 0; for (int i = 0; i < n; i++) s += pick(i); return s; }\n"
                   "__attribute__((noinline)) int tail(int n) { return add(n, 3); }\n"
                   "__attribute__((noinline)) int only_ptr(int x) { return x * 7 + 1; }\n"
                   "int (*fn)(int) = only_ptr;\n"
                   "void _start(void) { g_counter = loop(tail(2)) + fn(1); }\n")
    exe = tmp_path / "branches.exe"
    flags = [f for f in FLAGS if f not in ("-fno-pic", "-fno-pie")]
    subprocess.run([CC32, *flags, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    image = pe.read(exe.read_bytes(), exe.name)
    names = {f.name: f for f in image.functions}
    assert {"add", "pick", "loop", "tail", "only_ptr"} <= set(names)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    for f in image.functions:
        ins = list(md.disasm(f.code, f.vram))
        assert ins and ins[-1].mnemonic in ("ret", "jmp", "int3", "hlt", "ud2"), (f.name, len(f.code), ins[-1])
        assert len(f.code) > 3, f.name  # no epilogue slice became a function
    rows = sorted((f.vram, f.vram + len(f.code)) for f in image.functions)
    assert all(rows[i][1] <= rows[i + 1][0] for i in range(len(rows) - 1)), rows
    assert len(image.functions) <= 8


CXX32 = shutil.which("i686-w64-mingw32-g++")


@pytest.mark.skipif(CC32 is None, reason="needs i686-w64-mingw32-gcc")
def test_repair_boundaries_merges_an_old_split_and_keeps_the_match(tmp_path):
    """An import that cut `add` after its first instruction left a fragment. Repair folds the bytes back,
    and the restored whole function still matches the C."""
    src = tmp_path / "add.c"
    src.write_text("int add(int a, int b) { return a + b; }\n"
                   "void _start(void) { add(1, 2); }\n")
    exe = tmp_path / "add.exe"
    flags = [f for f in FLAGS if f not in ("-fno-pic", "-fno-pie")]
    subprocess.run([CC32, *flags, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    net = RomNetwork(tmp_path / "repair.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), toolchain="mingw-x86", confirmed=True, name=exe.name, log=lambda *_: None)
    proj = net.store.one("SELECT * FROM projects WHERE slug=?", slug)
    add = net.store.one("SELECT * FROM functions WHERE project_id=? AND name='add'", proj["id"])
    assert len(add["target"]) == 9
    # What the old splitter did: stop at a branch target (here, the second instruction).
    with net.store.tx() as db:
        db.execute("UPDATE functions SET size=4, n_insns=1, target=?, asm='' WHERE id=?",
                   (add["target"][:4], add["id"]))
        db.execute("INSERT INTO functions(project_id,name,size,n_insns,target,relocs,asm,unit,vram,rom_offset) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (proj["id"], f"sub_{add['vram'] + 4:08X}", 5, 2, add["target"][4:], "[]", "", add["unit"],
                    add["vram"] + 4, (add["rom_offset"] or 0) + 4))
    result = net.repair_boundaries(slug)
    assert result["merged"] == 1
    fixed = net.store.one("SELECT * FROM functions WHERE project_id=? AND name='add'", proj["id"])
    assert fixed["target"] == add["target"] and fixed["n_insns"] == 3
    assert not net.store.one("SELECT 1 FROM functions WHERE project_id=? AND name LIKE 'sub_%'", proj["id"])
    agent, _ = net.local_agent("repair-tester")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)


@pytest.mark.skipif(CC32 is None, reason="needs i686-w64-mingw32-gcc")
def test_retired_functions_leave_the_queue_and_the_count(tmp_path):
    src = tmp_path / "retire.c"
    src.write_text("int add(int a, int b) { return a + b; }\n"
                   "void _start(void) { add(1, 2); }\n")
    exe = tmp_path / "retire.exe"
    flags = [f for f in FLAGS if f not in ("-fno-pic", "-fno-pie")]
    subprocess.run([CC32, *flags, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    net = RomNetwork(tmp_path / "retire.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), toolchain="mingw-x86", confirmed=True, name=exe.name, log=lambda *_: None)
    before = net.overview(slug)["functions"]
    agent, _ = net.local_agent("retire-tester")
    assert "retired" in net.retire_function(agent, slug, "add", "this is only a test, and the instructions say so")
    assert net.store.one("SELECT status FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
                         "AND name='add'", slug)["status"] == "unmatchable"
    assert net.overview(slug)["functions"] == before - 1
    assert "RETIRED" in net.get_function("add", slug, agent)
    from decompnet.network import NetworkError

    other, _ = net.local_agent("other-agent")
    with pytest.raises(NetworkError, match="retired"):
        net.claim(other, slug, "add")


@pytest.mark.skipif(CXX32 is None, reason="needs i686-w64-mingw32-g++")
def test_32_bit_cxx_program_uses_x86_cpp_toolchain(tmp_path):
    src = tmp_path / "game32.cpp"
    src.write_text("namespace demo { __attribute__((noinline)) int add(int a, int b) { return a + b; } }\n"
                   "void _start(void) { demo::add(1, 2); }\n")
    exe = tmp_path / "game32-cxx.exe"
    flags = [f for f in FLAGS if f not in ("-fno-pic", "-fno-pie")]
    subprocess.run([CXX32, *flags, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    net = RomNetwork(tmp_path / "cxx32.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), toolchain="mingwxx-x86_64", confirmed=True, name="game32-cxx.exe",
                          log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["compiler"]["toolchain"] == "mingwxx-x86"
    assert ov["source_language"] == "C++" and ov["source_ext"] == ".cpp"
    # Old projects (and hand-edited configs) can still name an x86-64 compiler: opening the project repairs it.
    proj = net.store.one("SELECT * FROM projects WHERE slug=?", slug)
    cfg = json.loads(proj["config"])
    cfg["compiler"]["toolchain"] = "mingwxx-x86_64"
    with net.store.tx() as db:
        db.execute("UPDATE projects SET config=? WHERE id=?", (json.dumps(cfg), proj["id"]))
    ov = net.overview(slug, backfill=True)
    assert ov["compiler"]["toolchain"] == "mingwxx-x86"
    target = net.store.one(
        "SELECT name FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
        "AND name LIKE '%demo3addE%'", slug)["name"]
    agent, _ = net.local_agent("cxx32-tester")
    text = net.compile_and_diff(agent, target, "namespace demo { int add(int a, int b) { return a + b; } }", slug)
    assert "MATCH" in text, text


@pytest.mark.skipif(CXX is None, reason="needs x86_64-w64-mingw32-g++")
def test_cxx_programs_use_cpp_toolchain_and_language(tmp_path):
    src = tmp_path / "game.cpp"
    src.write_text("namespace demo { __attribute__((noinline)) int add(int a, int b) { return a + b; } }\n"
                   "void _start(void) { demo::add(1, 2); }\n")
    exe = tmp_path / "game-cxx.exe"
    subprocess.run([CXX, *FLAGS, "-nostdlib", "-Wl,--entry,_start", "-Wl,--subsystem,console", "-o", str(exe),
                    str(src)], check=True)
    net = RomNetwork(tmp_path / "cxx.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game-cxx.exe", log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["compiler"]["toolchain"] == "mingwxx-x86_64"
    assert ov["source_language"] == "C++" and ov["source_ext"] == ".cpp"
    target = net.store.one(
        "SELECT name FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
        "AND name LIKE '_ZN4demo3addE%'", slug)["name"]
    agent, _ = net.local_agent("cxx-tester")
    text = net.compile_and_diff(agent, target, "namespace demo { int add(int a, int b) { return a + b; } }", slug)
    assert "MATCH" in text, text


def test_compiler_preview_says_what_still_matches(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "preview.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    agent, _ = net.local_agent("preview-tester")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)
    assert "MATCH" in net.compile_and_diff(
        agent, "bump", "int g_counter;\nint bump(int n) { g_counter += n; return g_counter; }", slug)
    current = net.overview(slug)["compiler"]["toolchain"]
    r = net.preview_compiler(slug, current)
    assert r["checked"] >= 2 and r["kept"] == r["checked"] and r["broke"] == 0 and r["failed"] == 0
    assert r["installed"] and r["toolchain"] == current


def test_recheck_refreshes_stale_facts_and_writes_a_project_note(built):
    """Re-check re-reads the target instead of trusting cached facts, regenerates INTAKE.md, and leaves a
    project-wide note agents see in their claim brief. A second run with nothing new changes nothing."""
    exe, _obj = built
    net = RomNetwork(exe.parent / "recheck.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    proj = net.store.one("SELECT * FROM projects WHERE slug=?", slug)
    cfg = json.loads(proj["config"])
    cfg["rom"].update({"build_label": "stale build", "compiler_version": "0.0", "suggested_flags": ["-O0"]})
    with net.store.tx() as db:
        db.execute("UPDATE projects SET config=? WHERE id=?", (json.dumps(cfg), proj["id"]))
    r = net.recheck_project(slug)
    assert any(c.startswith("detected build: stale build → ") for c in r["changed"]), r["changed"]
    assert any(c.startswith("suggested flags: -O0 → ") for c in r["changed"]), r["changed"]
    assert r["detected"]["label"] and r["detected"]["label"] != "stale build"
    assert r["flags"] and r["flags"] != ["-O0"]
    intake = Path(r["intake"])
    assert intake.is_file() and "stale build" not in intake.read_text()
    note = net.store.one("SELECT text FROM notes WHERE project_id=? AND function_id IS NULL ORDER BY id DESC",
                         proj["id"])
    assert "Re-checked the target" in note["text"] and "detected build" in note["text"]
    again = net.recheck_project(slug)
    assert again["changed"] == [] and Path(again["intake"]).is_file()
    assert net.overview(slug)["detected"]["label"] == r["detected"]["label"]


def test_library_functions_are_marked_and_never_claimed(built):
    from decompnet.network import NetworkError

    exe, _obj = built
    net = RomNetwork(exe.parent / "lib.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    rows = {r["name"]: r for r in net.function_map(slug)}
    assert rows["_start"]["status"] == "library" and rows["_start"]["library"] == "CRT"
    assert net.overview(slug)["library"] >= 1
    agent, _ = net.local_agent("lib-tester")
    with pytest.raises(NetworkError, match="library"):
        net.claim(agent, slug, "_start")


def test_detected_flags_can_be_applied_and_still_match(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "flags.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    ov = net.overview(slug)
    suggested = ov["detected"]["suggested_flags"]
    assert suggested
    net.set_compiler(slug, ov["compiler"]["toolchain"], suggested)
    agent, _ = net.local_agent("flags-tester")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)


def test_data_symbols_are_listed_and_counted(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "data.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    rows = net.data_symbols(slug)
    assert any(r["name"] == "g_counter" and r["address"] for r in rows)
    assert net.overview(slug)["data"] == len(rows)
    assert net.data_symbols(slug, query="g_counter")


def test_pc_export_is_a_cmake_project_with_a_working_judge(built, tmp_path):
    import os
    import subprocess

    exe, _obj = built
    net = RomNetwork(exe.parent / "pc-export.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    agent, _ = net.local_agent("pc-export")
    assert "MATCH" in net.compile_and_diff(agent, "add", "int add(int a, int b) { return a + b; }", slug)
    assert "MATCH" in net.compile_and_diff(agent, "bump", "int g_counter;\nint bump(int n) { g_counter += n; return g_counter; }", slug)
    res = net.export_rom(slug)
    out = Path(res["path"])
    assert out.is_dir() and res["kind"] == "pc" and res["matched"] >= 2
    for name in ("CMakeLists.txt", "compile_commands.json", "include/context.h", "judge.py", "build.json",
                 "baserom.exe"):
        assert (out / name).is_file(), name
    assert (out / "src" / "add.c").is_file()
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent.parent / "src"))
    check = subprocess.run([sys.executable, "judge.py", "add"], cwd=out, env=env, capture_output=True, text=True)
    assert check.returncode == 0 and "MATCH" in check.stdout, check.stdout + check.stderr
    all_check = subprocess.run([sys.executable, "judge.py", "--all"], cwd=out, env=env, capture_output=True, text=True)
    assert all_check.returncode == 0, all_check.stdout + all_check.stderr


def test_runtime_trace_maps_addresses_and_names_to_functions(built, tmp_path):
    exe, _obj = built
    net = RomNetwork(exe.parent / "trace.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    image = pe.read(exe.read_bytes(), exe.name)
    add = next(f.vram for f in image.functions if f.name == "add")
    bump = next(f.vram for f in image.functions if f.name == "bump")
    _data = next(s.address for s in image.symbols if s.name == "g_counter")
    trace = tmp_path / "coverage.csv"
    trace.write_text(f"address,count\n0x{add:X},3\n0x{bump + 0x2:X},5\n0xDEADBEEF,1\n")
    result = net.import_trace(slug, str(trace))
    assert result["hits"] == 8 and result["functions"] == 2 and result["unmatched"] == 1
    hot = {r["name"]: r["hits"] for r in net.hot_functions(slug)}
    assert hot["add"] == 3 and hot["bump"] == 5
    assert net.overview(slug)["traced"] == 2 and net.overview(slug)["hits"] == 8
    rows = {r["name"]: r for r in net.function_map(slug)}
    assert rows["add"]["hits"] == 3
    again = net.import_trace(slug, str(trace))
    assert again["hits"] == 8 and net.hot_functions(slug)[0]["hits"] in (6, 10)


def test_intake_context_applies_notes_symbols_types_trace_and_libraries(built, tmp_path):
    exe, _obj = built
    net = RomNetwork(exe.parent / "intake.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    image = pe.read(exe.read_bytes(), exe.name)
    _add = next(f.vram for f in image.functions if f.name == "add")
    bump = next(f.vram for f in image.functions if f.name == "bump")
    data = next(s.address for s in image.symbols if s.name == "g_counter")
    refs = tmp_path / "reference"
    refs.mkdir()
    (refs / "README.md").write_text("known notes")
    symbols = tmp_path / "symbol_addrs.txt"
    symbols.write_text(f"intake_data = 0x{data:X}; // type:data\n")
    types = tmp_path / "types.h"
    types.write_text("typedef struct IntakeType { int a; } IntakeType;\n")
    trace = tmp_path / "coverage.csv"
    trace.write_text(f"0x{bump:X},7\n")
    report = net.apply_intake(slug, notes="focus on the unit AI", symbols=str(symbols), types=str(types),
                              refs=str(refs), trace=str(trace), libraries="bump")
    assert not report["warnings"], report["warnings"]
    assert "focus on the unit AI" in net.instructions(slug)
    assert refs.resolve() in net.references(slug)
    assert net.symbols(net._project(slug)["id"]).resolve("intake_data") == data
    assert "IntakeType" in net.get_context(slug)
    assert net.hot_functions(slug)[0]["name"] == "bump" and net.hot_functions(slug)[0]["hits"] == 7
    assert net.store.one("SELECT status FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) AND name='bump'",
                         slug)["status"] == "library"


def test_intake_report_writes_the_imports_findings_for_agents(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "report.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    report = net.write_intake(slug, log=lambda *_: None)
    text = report["markdown"]
    assert "PE" in text or "x86_64" in text
    assert "## Compiler" in text and "## Largest functions" in text and "## Code" in text
    assert "add" in text and "bump" in text and "g_counter" in text
    assert "## Most-called functions" in text and "## Subsystem hints" in text
    assert report["summary"] and "functions" in report["summary"]
    path = Path(report["path"])
    assert path.is_file() and path.name == "INTAKE.md" and "## Identity" in path.read_text()
    line = net.intake_line(slug)
    assert str(path) in line and "read it first" in line
    assert line in net.claim(net.local_agent("report-agent")[0], slug)


def test_search_facts_finds_names_symbols_and_callers(built):
    exe, _obj = built
    net = RomNetwork(exe.parent / "facts.db", exe.parent)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="game.exe", log=lambda *_: None)
    found = net.search_facts(slug, "add")
    assert "`add`" in found and "callers" in found
    symbol = net.search_facts(slug, "g_counter")
    assert "`g_counter`" in symbol and "used by" in symbol
    address = net.search_facts(slug, "0x140001000")
    assert "Address 0x140001000" in address
    groups = net.subsystem_text(slug)
    assert "Subsystem hints" in groups and "unclassified" in groups
