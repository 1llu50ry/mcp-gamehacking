"""Linux-only compilers on Windows, through WSL 2 (issues #1, #4: EE-GCC and friends had no Windows build).

Run here with the platform set to Windows and a stand-in for wsl.exe that runs the command on this computer, which
has no 32-bit loader (/lib/ld-linux.so.2): EE-GCC can only work through the pinned runtime the install wraps in.
"""

import os
import shutil
import sys

import pytest

from decompnet import compiler, project, toolchains, wsl

REAL = toolchains.root() / ".downloads"
EE = "ee-gcc2.96.tar.xz"
DEB = "libc6-i386_2.41-12_amd64.deb"

pytestmark = pytest.mark.skipif(sys.platform != "linux" or not (REAL / EE).exists(),
                                reason="needs Linux and the EE-GCC archive in the local download cache")


@pytest.fixture
def windows(tmp_path, monkeypatch):
    fake = tmp_path / "wsl"
    fake.write_text('#!/bin/sh\n[ "$1" = "-e" ] && shift\n'
                    '[ "$1" = "uname" ] && { echo 6.6.87.2-microsoft-standard-WSL2; exit 0; }\nexec "$@"\n')
    fake.chmod(0o755)
    monkeypatch.setenv("DECOMP_WSL", str(fake))
    monkeypatch.setattr(toolchains, "current_platform", lambda: "windows-x86_64")
    monkeypatch.setattr(wsl, "_status", None)
    root = tmp_path / "toolchains"
    (root / ".downloads").mkdir(parents=True)
    for name in (EE, DEB):
        if (REAL / name).exists():
            shutil.copy(REAL / name, root / ".downloads" / name)
    monkeypatch.setenv("DECOMPNET_TOOLCHAINS", str(root))
    return root


def test_linux_only_compilers_install_and_run_through_wsl(windows):
    tc = toolchains.get("ee-gcc-2.96")
    assert tc.via_wsl and tc.supported and not toolchains.get("binutils-mips").via_wsl  # that one has a Windows build
    toolchains.install("ee-gcc-2.96", log=lambda *_: None)
    home = windows / "wsl" / "ee-gcc-2.96"
    assert toolchains.installed("ee-gcc-2.96")["wsl"] and (windows / "wsl" / "runtime-i386" / "ld-linux.so.2").exists()
    gcc = home / "bin" / "ee-gcc"
    assert gcc.read_text().startswith("#!/bin/sh") and wsl.is_dynamic_i386(home / "bin" / "ee-gcc.i386")

    cfg = project.compiler_config(windows, {"compiler": {"toolchain": "ee-gcc-2.96"}})
    assert cfg.wsl and cfg.runtime32 is None and cfg.cmd[0] == str(gcc)
    res = compiler.compile_source(cfg, "typedef int s32;", "s32 add_one(s32 a) { return a * 3 + 1; }")
    assert res.ok, res.log
    assert res.obj[:4] == b"\x7fELF" and b"add_one" in res.obj


def test_without_wsl_the_app_says_how_to_get_it(windows, monkeypatch):
    monkeypatch.setenv("DECOMP_WSL", str(windows / "missing-wsl"))
    with pytest.raises(toolchains.ToolchainError, match="wsl --install"):
        toolchains.install("ee-gcc-2.96", log=lambda *_: None)


def test_windows_paths_as_wsl_sees_them(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(wsl, "_mount", "/mnt/")
    monkeypatch.setattr(os.path, "abspath", lambda p: p)
    assert wsl.path(r"C:\Users\Jane Doe\AppData\Local\decompnet") == "/mnt/c/Users/Jane Doe/AppData/Local/decompnet"
    assert wsl.path("D:\\") == "/mnt/d"


def test_debian_packages_unpack_without_tar(tmp_path):
    if not (REAL / DEB).exists():
        pytest.skip("needs the Debian runtime package in the local download cache")
    out = tmp_path / "rt"
    out.mkdir()
    toolchains._extract(REAL / DEB, out, "usr/lib32")
    assert (out / "ld-linux.so.2").stat().st_size > 100_000 and (out / "libc.so.6").exists()
