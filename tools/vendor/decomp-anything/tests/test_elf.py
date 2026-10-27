"""Linux ELF targets: reading functions out of a program, and matching compiled C against them.

The fixtures are built with the GCC already on the machine and the toolchain's own flags, so both sides are
real compiler output: the program is split by decomp.wtf, the candidate is compiled by the same compiler,
and the x86 matcher has to accept it byte for byte, library calls through the PLT included.
"""

import shutil
import subprocess

import pytest

from decompnet import toolchains
from decompnet.app.engine import RomNetwork
from decompnet.rom import detect, elfexe

CC = shutil.which("gcc")
CXX = shutil.which("g++")
# A real program keeps its unwind tables (.eh_frame): that is what splits a stripped one. They don't change code.
FLAGS = [f for f in toolchains.get("gcc-linux-x86_64").flags if f != "-fno-asynchronous-unwind-tables"]

pytestmark = pytest.mark.skipif(CC is None, reason="needs gcc")

# Two files, like a real program: within one file GCC knows a callee's needs (IPA) and may skip the stack
# alignment around a call, which a function compiled on its own (as an agent's is) can't know.
LIB = r"""
int add(int a, int b) { return a + b; }
int mul3(int a) { return add(a, a) * 3; }
"""
SOURCE = r"""
#include <string.h>
int add(int a, int b);
int mul3(int a);
int g_counter;
__attribute__((noinline)) int bump(int n) { g_counter += n; return g_counter; }
__attribute__((noinline)) int twice(int n) { return mul3(n) + 1; }
__attribute__((noinline)) unsigned long measure(const char *s) { return strlen(s) + 1; }
__attribute__((noinline)) const char *greeting(void) { return "hello there"; }
int table[16];
__attribute__((noinline)) int pick(int i) { return table[i]; }
__attribute__((noinline)) int scale(int x) { return x * 0x1234; }
int main(int argc, char **argv) { return bump(twice(argc)) + (int)measure(argv[0]) + *greeting() + pick(argc) + scale(argc); }
"""

MATCHES = {
    "add": "int add(int a, int b) { return a + b; }",
    "bump": "int g_counter;\nint bump(int n) { g_counter += n; return g_counter; }",
    "twice": "int mul3(int a);\nint twice(int n) { return mul3(n) + 1; }",
    "measure": "unsigned long strlen(const char *s);\nunsigned long measure(const char *s) { return strlen(s) + 1; }",
    "pick": "extern int table[16];\nint pick(int i) { return table[i]; }",
    # In a position-independent program 0x1234 is also an address inside the image: still just a number.
    "scale": "int scale(int x) { return x * 0x1234; }",
}


def _build(work, *extra, name="prog"):
    (work / "prog.c").write_text(SOURCE)
    (work / "lib.c").write_text(LIB)
    exe = work / name
    subprocess.run([CC, *FLAGS, *extra, "-o", str(exe), str(work / "prog.c"), str(work / "lib.c")], check=True)
    return exe


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    return _build(tmp_path_factory.mktemp("elf"), "-no-pie")


def test_reads_functions_imports_and_compiler(built):
    data = built.read_bytes()
    assert elfexe.is_x86_elf(data)
    image = elfexe.read(data, "prog")
    assert image.arch == "x86_64" and not image.info["pie"]
    names = {f.name for f in image.functions}
    assert {"add", "mul3", "bump", "twice", "measure", "main"} <= names
    assert not names & elfexe.CRT  # the C library's start-up code is not the program's
    syms = {s.name: s for s in image.symbols}
    assert "strlen" in syms and "strlen@got" in syms  # the PLT stub and its slot
    assert all(f.exact for f in image.functions if f.name in MATCHES)


def test_stripped_programs_split_from_eh_frame(built, tmp_path):
    stripped = tmp_path / "prog.stripped"
    shutil.copy(built, stripped)
    subprocess.run(["strip", str(stripped)], check=True)
    image = elfexe.read(stripped.read_bytes(), "prog")
    full = elfexe.read(built.read_bytes(), "prog")
    by_addr = {f.vram: len(f.code) for f in full.functions}
    found = {f.vram: len(f.code) for f in image.functions}
    for name in MATCHES:  # every function, at its own address and size, under a sub_ name
        fn = next(f for f in full.functions if f.name == name)
        assert found.get(fn.vram) == by_addr[fn.vram]
    assert any(f.name.startswith("sub_") for f in image.functions)


def test_detects_linux_programs(built):
    picked = detect.identify(built)
    assert picked.platform == "linux" and picked.filename == "prog"


def test_import_and_match_through_the_engine(built):
    net = RomNetwork(built.parent / "decomp.db", built.parent)
    slug = net.import_rom(built.read_bytes(), confirmed=True, name="prog", log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["platform"] == "linux" and ov["platform_name"] == "Linux"
    assert ov["compiler"]["toolchain"] == "gcc-linux-x86_64"
    assert ov["source_language"] == "C" and ov["source_ext"] == ".c"
    agent, _ = net.local_agent("linux-tester")
    for name, source in MATCHES.items():
        text = net.compile_and_diff(agent, name, source, slug)
        assert "MATCH" in text, f"{name}: {text}"
    text = net.compile_and_diff(agent, "add", "int add(int a, int b) { return a - b; }", slug)
    assert "MATCH" not in text


def test_position_independent_programs_compile_with_fpie(tmp_path):
    exe = _build(tmp_path, "-pie", "-fPIE", name="pie")
    net = RomNetwork(tmp_path / "d.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="pie", log=lambda *_: None)
    assert "-fPIE" in net.overview(slug)["compiler"]["flags"]
    agent, _ = net.local_agent("pie-tester")
    for name in ("add", "bump", "measure", "twice", "scale"):
        text = net.compile_and_diff(agent, name, MATCHES[name], slug)
        assert "MATCH" in text, f"{name}: {text}"


@pytest.mark.skipif(CC is None or CXX is None, reason="needs g++")
def test_cxx_programs_use_cpp_toolchain_and_language(tmp_path):
    source = tmp_path / "prog.cpp"
    source.write_text(r"""
namespace demo {
__attribute__((noinline)) int add(int a, int b) { return a + b; }
}
int main(int argc, char **argv) { return demo::add(argc, 3); }
""")
    exe = tmp_path / "prog-cxx"
    subprocess.run([CXX, *FLAGS, "-no-pie", "-o", str(exe), str(source)], check=True)
    net = RomNetwork(tmp_path / "cxx.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="prog-cxx", log=lambda *_: None)
    ov = net.overview(slug)
    assert ov["compiler"]["toolchain"] == "gxx-linux-x86_64"
    assert ov["source_language"] == "C++" and ov["source_ext"] == ".cpp"
    target = net.store.one(
        "SELECT name FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
        "AND name LIKE '_ZN4demo3addE%'", slug)["name"]
    agent, _ = net.local_agent("cxx-tester")
    text = net.compile_and_diff(agent, target, "namespace demo { int add(int a, int b) { return a + b; } }", slug)
    assert "MATCH" in text, text


def _can_m32() -> bool:
    try:
        subprocess.run([CC, "-m32", "-x", "c", "-o", "/dev/null", "-"], input=b"int main(void){return 0;}",
                       check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


@pytest.mark.skipif(CC is None or not _can_m32(), reason="needs gcc-multilib")
def test_32_bit_programs(tmp_path):
    exe = _build(tmp_path, "-m32", "-no-pie", name="prog32")
    net = RomNetwork(tmp_path / "d.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="prog32", log=lambda *_: None)
    assert net.overview(slug)["compiler"]["toolchain"] == "gcc-linux-x86"
    agent, _ = net.local_agent("x86-linux-tester")
    for name in ("add", "bump", "pick", "measure"):
        text = net.compile_and_diff(agent, name, MATCHES[name], slug)
        assert "MATCH" in text, f"{name}: {text}"


@pytest.mark.skipif(CC is None, reason="needs gcc")
def test_pc_export_and_judge_for_linux(tmp_path):
    import os
    import sys
    from pathlib import Path

    exe = _build(tmp_path, "-no-pie")
    net = RomNetwork(tmp_path / "export.db", tmp_path)
    slug = net.import_rom(exe.read_bytes(), confirmed=True, name="prog", log=lambda *_: None)
    agent, _ = net.local_agent("linux-export")
    assert "MATCH" in net.compile_and_diff(agent, "add", MATCHES["add"], slug)
    res = net.export_rom(slug)
    out = Path(res["path"])
    assert (out / "CMakeLists.txt").is_file() and (out / "compile_commands.json").is_file()
    assert (out / "judge.py").is_file() and (out / "baserom.elf").is_file()
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent.parent / "src"))
    check = subprocess.run([sys.executable, "judge.py", "add"], cwd=out, env=env, capture_output=True, text=True)
    assert check.returncode == 0 and "MATCH" in check.stdout, check.stdout + check.stderr
