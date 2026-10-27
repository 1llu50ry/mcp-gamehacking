"""Reference folders: what the user names in a ROM project's instructions, agents can read and search."""
import os

import pytest

from decompnet.app import references, tools
from decompnet.network import NetworkError


@pytest.fixture
def ref(tmp_path):
    root = tmp_path / "Total Annihilation" / "byte-tactics"
    (root / "src" / "game").mkdir(parents=True)
    (root / "src" / "game" / "economy.cpp").write_text("// FUNCTION: 0x401070\nvoid UnitResources::Reset(unsigned char p)\n")
    (root / "data").mkdir()
    (root / "data" / "symbols.csv").write_text("address,name\n0x401070,UnitResources::Reset\n")
    for hidden in (".worktrees/issue-1/src", "build", "orig", ".git"):
        (root / hidden).mkdir(parents=True)
        (root / hidden / "copy.cpp").write_text("// FUNCTION: 0x401070\n")
    (root / "orig" / "TotalA.exe").write_bytes(b"MZ\0\0" + b"\0" * 64)
    return root


def test_named_folders_keep_their_spaces(ref, tmp_path):
    said = f"Examine {ref} for clues on how things map.\nAlso {tmp_path}/nowhere and ~/"
    assert references.named(said) == [ref.resolve()]
    assert references.named(f"see {ref}.") == [ref.resolve()]
    assert references.named("/ and ~ and ~/ are never folders to read") == []


def test_reads_stay_inside_and_skip_the_game(ref, tmp_path):
    roots = [ref.resolve()]
    assert "UnitResources::Reset" in references.read(roots, "src/game/economy.cpp")
    assert "economy.cpp" in references.read(roots, "src/game")
    assert "byte-tactics" in references.read(roots, f"{ref}/data/symbols.csv")
    (tmp_path / "secret.txt").write_text("nope")
    os.symlink(tmp_path / "secret.txt", ref / "link.txt")
    for bad in ("../../secret.txt", str(tmp_path / "secret.txt"), "link.txt", "orig/TotalA.exe", ".git/copy.cpp"):
        with pytest.raises(NetworkError):
            references.read(roots, bad)


def test_search_finds_an_address_and_skips_copies(ref):
    hits = references.search([ref.resolve()], "0x401070").splitlines()
    assert hits == ["data/symbols.csv:2: 0x401070,UnitResources::Reset", "src/game/economy.cpp:1: // FUNCTION: 0x401070"]
    assert references.search([ref.resolve()], "unitresources::reset", glob="data/*.csv").startswith("data/symbols.csv:2")


def test_rom_projects_get_the_reading_tools():
    assert {"read_file", "search_code", "search_facts", "list_subsystems"} <= set(tools.tool_names(fork=False))
    assert "edit_file" not in tools.tool_names(fork=False)
    assert "search_facts" in tools.tool_names(analysis=True)
    assert "list_subsystems" not in tools.tool_names(analysis=True)
