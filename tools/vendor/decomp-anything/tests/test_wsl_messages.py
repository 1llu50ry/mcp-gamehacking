"""WSL setup messages: short, one install command, no pasted Microsoft boilerplate."""

import pytest

from decompnet import wsl


def test_not_installed_error_is_short_and_not_duplicated(monkeypatch):
    monkeypatch.setattr(wsl, "exe", lambda: "wsl")
    monkeypatch.setattr(wsl, "_run", lambda *args, **kwargs: (1, "The Windows Subsystem for Linux is not installed. "
                                                       "You can install by running 'wsl.exe --install'. For more "
                                                       "information please visit https://aka.ms/wslinstall"))
    ok, why = wsl._check()
    assert not ok
    assert why.startswith("WSL 2 isn't installed.")
    assert why.count("wsl --install") == 1 and "wsl.exe --install" not in why and "aka.ms" not in why


def test_no_distribution_error_names_the_next_step(monkeypatch):
    monkeypatch.setattr(wsl, "exe", lambda: "wsl")
    monkeypatch.setattr(wsl, "_run", lambda *args, **kwargs: (1, "Windows Subsystem for Linux has no installed distributions."))
    ok, why = wsl._check()
    assert not ok and why.startswith("WSL 2 has no Linux distribution installed.")
    assert "wsl --install" in why


def test_wsl_compiler_error_does_not_repeat_that_it_is_linux(monkeypatch):
    from decompnet import toolchains

    monkeypatch.setattr(toolchains, "current_platform", lambda: "windows-x86_64")
    monkeypatch.setattr(toolchains.wsl, "wanted", lambda: True)
    msg = "WSL 2 isn't installed. In PowerShell as administrator, run: wsl --install."
    monkeypatch.setattr(toolchains.wsl, "status", lambda: (False, msg))
    with pytest.raises(toolchains.ToolchainError) as e:
        toolchains.install("gcc-2.7.2-kmc", log=lambda *_: None)
    msg = str(e.value)
    assert msg.startswith("GCC 2.7.2") and " runs in WSL 2 on Windows. WSL 2 isn't installed." in msg
    assert "is a Linux program" not in msg and msg.count("wsl --install") == 1
