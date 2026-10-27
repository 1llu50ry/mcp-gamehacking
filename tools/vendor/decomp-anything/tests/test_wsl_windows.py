"""Linux-only compilers through the real WSL 2, on Windows. test_wsl.py runs the same code on Linux against a
stand-in for wsl.exe, where no file has a Windows drive's 64-bit file ID: the old 32-bit compilers can't look those
up ("Value too large for defined data type"), so only a real Windows drive shows whether they work."""

import sys
from pathlib import Path

import pytest

from decompnet import compiler, project, toolchains, wsl

SOURCE = "s32 add_one(s32 a) { return a * 3 + 1; }"


@pytest.fixture
def psx():
    if sys.platform != "win32":
        pytest.skip("needs Windows")
    ok, why = wsl.status()
    if not ok:
        pytest.skip(why)
    if not toolchains.installed("gcc-2.7.2-psx"):
        pytest.skip("needs gcc-2.7.2-psx (decompnet toolchain install gcc-2.7.2-psx)")
    return project.compiler_config(Path("."), {"compiler": {"toolchain": "gcc-2.7.2-psx"}})


def test_old_compilers_compile_from_a_windows_drive(psx):
    res = compiler.compile_source(psx, "typedef int s32;", SOURCE)
    assert res.ok, res.log
    assert res.obj[:4] == b"\x7fELF" and b"add_one" in res.obj


def test_exported_projects_build_from_a_windows_drive(psx, tmp_path):
    (tmp_path / "include").mkdir()
    (tmp_path / "include" / "common.h").write_text("typedef int s32;\n")
    (tmp_path / "src" / "main").mkdir(parents=True)
    (tmp_path / "src" / "main" / "add_one.c").write_text(f'#include "common.h"\n{SOURCE}\n')
    (tmp_path / "build" / "src" / "main").mkdir(parents=True)
    src, obj = "src/main/add_one.c", "build/src/main/add_one.o"
    argv = [a.replace("{src}", src).replace("{obj}", obj).replace("{include}", "include") for a in psx.cmd]
    res = compiler.run_in(psx, tmp_path, argv, inputs=[src, "include"], outputs=[obj])
    assert res.returncode == 0, res.stdout + res.stderr
    assert (tmp_path / obj).read_bytes()[:4] == b"\x7fELF"
