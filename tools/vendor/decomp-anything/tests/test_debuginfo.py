"""Debug information that already exists beside a program: PDB, DWARF, MAP and symbol_addrs.txt."""

import shutil
import subprocess
from pathlib import Path
from typing import ClassVar

import pytest

from decompnet.rom import debuginfo, pe
from decompnet.rom.symbols import Symbol

CC = shutil.which("gcc")
CLANG_CL = shutil.which("clang-cl")
LLD_LINK = shutil.which("lld-link")
PDBUTIL = shutil.which("llvm-pdbutil")


def test_symbol_addrs_round_trip(tmp_path):
    text = """
    // a comment
    func_80001000 = 0x80001000; // type:func size:0x40
    D_80002000 = 0x80002000; // type:data size:0x10
    not a symbol
    """
    info = debuginfo.read(tmp_path / "symbol_addrs.txt", data=text.encode())
    assert [(s.name, s.address, s.size, s.kind) for s in info.symbols] == [
        ("func_80001000", 0x80001000, 0x40, "func"), ("D_80002000", 0x80002000, 0x10, "data")]
    exported = debuginfo.symbol_addrs_text(info.symbols)
    again = debuginfo.read(tmp_path / "again.txt", data=exported.encode())
    assert [(s.name, s.address, s.size, s.kind) for s in again.symbols] == [
        (s.name, s.address, s.size, s.kind) for s in info.symbols]


def test_map_files_from_both_linkers(tmp_path):
    gnu = """
     .text          0x0000000000401000      0x120 /tmp/a.o
                    0x0000000000401000                add
                    0x0000000000401010                player_score
    """
    info = debuginfo.read(tmp_path / "gnu.map", data=gnu.encode())
    assert [(s.name, s.address) for s in info.symbols] == [("add", 0x401000), ("player_score", 0x401010)]

    msvc = """
 Preferred load address is 0000000140000000

  Address         Publics by Value              Rva+Base               Lib:Object
 0001:00000000       add                        0000000140001000     demo.obj
 0001:00000020       player_score               0000000140001020     demo.obj
    """
    info = debuginfo.read(tmp_path / "demo.map", data=msvc.encode())
    assert [(s.name, s.address) for s in info.symbols] == [
        ("add", 0x140001000), ("player_score", 0x140001020)]


def test_symbols_json_is_a_stable_export():
    text = debuginfo.symbols_json([Symbol("add", 0x401000, 5, "func")])
    assert '"address": "0x401000"' in text and '"kind": "func"' in text


@pytest.mark.skipif(CC is None, reason="needs gcc")
def test_dwarf_names_types_and_signatures(tmp_path):
    src = tmp_path / "demo.c"
    src.write_text("""typedef struct Player { int health; int mana; char name[16]; } Player;
int add(int a, int b) { return a + b; }
int player_score(const Player *p) { return p->health + p->mana; }
int main(void) { Player p = {1, 2, "x"}; return player_score(&p); }
""")
    exe = tmp_path / "demo"
    subprocess.run([CC, "-g", "-O0", "-no-pie", "-o", str(exe), str(src)], check=True)
    info = debuginfo.read(exe)
    assert {f.name for f in info.functions} >= {"add", "player_score", "main"}
    add = next(f for f in info.functions if f.name == "add")
    assert add.address and add.size and "int add(int, int)" in add.signature
    assert "struct Player" in info.header
    assert "char name[16];" in info.header
    assert "int add(int, int)" in info.header


@pytest.mark.skipif(not (CLANG_CL and LLD_LINK and PDBUTIL), reason="needs clang-cl, lld-link and llvm-pdbutil")
def test_pdb_names_sizes_and_types(tmp_path):
    src = tmp_path / "demo.c"
    src.write_text("""typedef struct Player { int health; int mana; char name[16]; } Player;
int add(int a, int b) { return a + b; }
int player_score(const Player *p) { return p->health + p->mana; }
int main(void) { Player p = {1, 2, "x"}; return player_score(&p); }
""")
    obj, exe = tmp_path / "demo.obj", tmp_path / "demo.exe"
    subprocess.run([CLANG_CL, "/nologo", "/c", "/Zi", "/Od", "/GS-", f"/Fo{obj}", str(src)], check=True)
    subprocess.run([LLD_LINK, "/nologo", "/debug", "/nodefaultlib", "/entry:main", "/subsystem:console",
                    f"/out:{exe}", str(obj)], check=True)
    pdb = exe.with_suffix(".pdb")
    assert pdb.is_file() and debuginfo.find_pdb(exe, exe.read_bytes()) == pdb
    image = pe.read(exe.read_bytes(), exe.name)
    info = debuginfo.read(pdb, image=image)
    funcs = {f.name: f for f in info.functions}
    assert {"add", "player_score", "main"} <= funcs.keys()
    assert image.image_base < funcs["add"].address < image.image_base + max(s.va + s.size for s in image.sections)
    assert funcs["add"].size == 17 and "int add(int, int)" in funcs["add"].signature
    assert "struct Player" in info.header and "char name[16];" in info.header
    assert "int add(int, int);" in info.header
    auto = debuginfo.discover(exe)
    assert auto is not None and auto.source.startswith("PDB") and auto.functions


@pytest.mark.skipif(not (CLANG_CL and LLD_LINK and PDBUTIL), reason="needs clang-cl, lld-link and llvm-pdbutil")
def test_pdb_uses_the_image_sections_when_the_dump_has_none():
    """llvm-pdbutil can be asked for symbols without section headers; the PE still has them."""
    text = """                       Public Symbols
  Records
       0 | S_PUB32 [size = 20] `add`
           flags = function, addr = 0001:0010
"""
    class Section:
        va = 0x1000
        size = 0x100
    class Image:
        image_base = 0x140000000
        sections: ClassVar[list] = [Section()]
    info = debuginfo._parse_pdb(text, image=Image())
    assert info.functions and info.functions[0].address == 0x140001010 and info.functions[0].name == "add"


CLANG_CL = shutil.which("clang-cl")
LLD_LINK = shutil.which("lld-link")
PDBUTIL = shutil.which("llvm-pdbutil")


@pytest.mark.skipif(not (CLANG_CL and LLD_LINK and PDBUTIL), reason="needs clang-cl, lld-link and llvm-pdbutil")
def test_engine_imports_a_pdb_and_exports_it_again(tmp_path):
    from decompnet.app.engine import RomNetwork

    src = tmp_path / "demo.c"
    src.write_text("""typedef struct Player { int health; int mana; char name[16]; } Player;
int add(int a, int b) { return a + b; }
int player_score(const Player *p) { return p->health + p->mana; }
int main(void) { Player p = {1, 2, "x"}; return player_score(&p); }
""")
    obj, exe = tmp_path / "demo.obj", tmp_path / "demo.exe"
    subprocess.run([CLANG_CL, "/nologo", "/c", "/Zi", "/Od", "/GS-", f"/Fo{obj}", str(src)], check=True)
    subprocess.run([LLD_LINK, "/nologo", "/debug", "/nodefaultlib", "/entry:main", "/subsystem:console",
                    f"/out:{exe}", str(obj)], check=True)
    isolated = tmp_path / "isolated"
    isolated.mkdir()
    lonely = isolated / "game.exe"
    lonely.write_bytes(exe.read_bytes())
    if shutil.which("llvm-strip"):
        subprocess.run(["llvm-strip", "--strip-all", str(lonely)], check=True)  # no COFF names: split gives sub_
    pdb = exe.with_suffix(".pdb")
    saved_pdb = tmp_path / "saved.pdb"
    pdb.rename(saved_pdb)  # make the automatic sidecar lookup miss: import it explicitly below
    ws = tmp_path / "ws"
    ws.mkdir()
    net = RomNetwork(ws / "decomp.db", ws)
    slug = net.import_rom(lonely, confirmed=True, name="game.exe", log=lambda *_: None)
    before = net.store.one("SELECT name FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
                           "AND vram=?", slug, 0x140001000)["name"]
    assert before.startswith("sub_")
    result = net.import_debug_info(slug, str(saved_pdb))
    assert result["renamed"] >= 1 and not result["warning"]
    after = net.store.one("SELECT name FROM functions WHERE project_id=(SELECT id FROM projects WHERE slug=?) "
                          "AND vram=?", slug, 0x140001000)["name"]
    assert after == "add"
    assert "struct Player" in net.get_context(slug)
    exported = net.export_debug_info(slug)
    assert Path(exported["symbol_addrs"]).is_file() and Path(exported["types_header"]).is_file()
    assert "add = 0x" in Path(exported["symbol_addrs"]).read_text()
