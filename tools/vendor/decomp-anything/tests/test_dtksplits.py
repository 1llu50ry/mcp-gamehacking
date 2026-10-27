"""Editing a dtk-template project's file layout like a contributor: splits.txt round trips, configure.py gets new
files in the right library with the settings its neighbours use, or a new library made like a sibling module's."""

import struct

from decompnet.forks import dtksplits

SPLITS = """Sections:
\t.text       type:code align:4
\t.rodata     type:rodata align:32
\t.data       type:data align:8

REL/m656DLL/prolog.c:
\t.text       start:0x00000000 end:0x000000A0

REL/m656DLL/game.c:
\t.text       start:0x000000A0 end:0x0000961C
\t.rodata     start:0x00000000 end:0x00000220
\t.data       start:0x00000000 end:0x000006CA
"""

CONFIGURE = '''\
def Rel(lib_name, objects):
    return {"lib": lib_name, "mw_version": "GC/1.3.2", "objects": objects}


config.libs = [
    {
        "lib": "Runtime.PPCEABI.H",
        "objects": [
            Object(Matching, "Runtime.PPCEABI.H/__va_arg.c"),
            Object(NonMatching, "Runtime.PPCEABI.H/ptmf.c"),
        ],
    },
    Rel(
        "m656DLL",
        objects={
            Object(Matching, "REL/m656DLL/prolog.c", extra_cflags=["-pooldata off"]),
            Object(
                NonMatching,
                "REL/m656DLL/game.c",
                extra_cflags=["-pooldata off"],
            ),
            Object(Matching, "REL/m656DLL/runtime.c", extra_cflags=["-DRUNTIME=1", "-pooldata off"]),
        },
    ),
]
'''


def test_splits_round_trip_and_owner():
    sp = dtksplits.Splits.parse(SPLITS)
    assert sp.render() == SPLITS
    assert [f.name for f in sp.files] == ["REL/m656DLL/prolog.c", "REL/m656DLL/game.c"]
    assert sp.owner(".text", 0x100).name == "REL/m656DLL/game.c" and sp.owner(".rodata", 0x300) is None


def test_libraries_and_their_files():
    libs = dtksplits.libs(CONFIGURE)
    assert [lib.name for lib in libs] == ["Runtime.PPCEABI.H", "m656DLL"]
    assert [p for p, _, _ in libs[1].objects] == ["REL/m656DLL/prolog.c", "REL/m656DLL/game.c", "REL/m656DLL/runtime.c"]


def test_a_new_file_goes_next_to_its_neighbours_with_their_settings():
    text = dtksplits.add_objects(CONFIGURE, "m656DLL", ["REL/m656DLL/text_00001000.c"])
    assert 'Object(NonMatching, "REL/m656DLL/text_00001000.c", extra_cflags=["-pooldata off"])' in text
    assert "RUNTIME=1\", \"-pooldata off\"]),\n            Object(NonMatching" in text
    assert dtksplits.add_objects(text, "m656DLL", ["REL/m656DLL/text_00001000.c"]) == text  # listed already
    compile(text, "configure.py", "exec")


def test_a_module_without_a_library_gets_one_like_its_sibling():
    text = dtksplits.add_objects(CONFIGURE, "m657DLL", ["REL/m657DLL/text_00000000.cpp"])
    libs = dtksplits.libs(text)
    assert [lib.name for lib in libs] == ["Runtime.PPCEABI.H", "m656DLL", "m657DLL"]
    assert [p for p, _, _ in libs[2].objects] == ["REL/m657DLL/text_00000000.cpp"]
    assert 'Rel(\n        "m657DLL",\n        objects={\n            Object(NonMatching, "REL/m657DLL/text_00000000.cpp", ' \
           'extra_cflags=["-pooldata off"]),\n        },\n    ),' in text
    compile(text, "configure.py", "exec")


def test_a_program_with_two_sections_of_one_name_gets_unique_names(tmp_path):
    """Mario Kart: Double Dash!! has a section of its own (.BINARY, archives) before .rodata. dtk names both .rodata,
    writes that into splits.txt and then can't read it back ("Multiple sections with name .rodata"). The extra one
    gets a name of its own (letters and digits: dtk reads no other section names in symbols.txt), the usual name
    stays on the section where the standard layout has it, and dtk analyses the program again (its symbols start over)."""
    from decompnet.forks.scratch_dtk import _unique_sections

    config = tmp_path / "config" / "GM4P01"
    config.mkdir(parents=True)
    (config / "splits.txt").write_text(
        "Sections:\n\t.init       type:code align:4\n\t.ctors      type:rodata align:32\n\t.rodata     type:rodata align:32\n"
        "\t.rodata     type:rodata align:8\n\t.data       type:data align:16\n\nauto_00_80003100_init.s:\n"
        "\t.init       start:0x80003100 end:0x80003154\n", encoding="utf-8")
    (config / "symbols.txt").write_text("lbl_802D8AA0 = .rodata:0x802D8AA0; // type:object size:0x5413A\n", encoding="utf-8")
    assert _unique_sections(tmp_path, "GM4P01") == [".rodata2"]
    assert (config / "splits.txt").read_text(encoding="utf-8") == (
        "Sections:\n\t.init       type:code align:4\n\t.ctors      type:rodata align:32\n\t.rodata2    type:rodata align:32\n"
        "\t.rodata     type:rodata align:8\n\t.data       type:data align:16\n")
    assert not (config / "symbols.txt").exists()
    assert _unique_sections(tmp_path, "GM4P01") == []  # nothing left to rename


def test_hand_written_code_gets_a_function_hint(tmp_path):
    """Mario Kart Wii's copy routine has branch targets dtk takes for a function inside a function ("Overlapping
    functions"): the first is declared to end where the second starts, and the analysis runs again."""
    from decompnet.forks.scratch_dtk import _overlap_hint

    (tmp_path / "config" / "RMCP01").mkdir(parents=True)
    tail = "Caused by:\n    Overlapping functions 3:0x800E9D34-3:0x800E9DA0 -> 3:0x800E9D44\nninja: error"
    assert _overlap_hint(tmp_path, "RMCP01", tail) == "0x800E9D34"
    assert (tmp_path / "config" / "RMCP01" / "symbols.txt").read_text() == \
        "fn_800E9D34 = .text:0x800E9D34; // type:function size:0x10\n"
    assert _overlap_hint(tmp_path, "RMCP01", tail) is None  # said once: no loop
    assert _overlap_hint(tmp_path, "RMCP01", "some other failure") is None


def test_a_link_failure_tries_the_next_newer_linker(monkeypatch, tmp_path):
    from decompnet.forks import scratch_dtk

    for v in ("GC/1.3.2", "GC/2.7"):  # 2.6 isn't installed here: skipped
        (tmp_path / v).mkdir(parents=True)
        (tmp_path / v / "mwldeppc.exe").write_bytes(b"")
    monkeypatch.setattr(scratch_dtk.toolchains, "path", lambda tid: tmp_path)
    crash = "### mwldeppc.exe Linker Error:\n#   internal linker error: File: 'ELF_PPC_EABI.c' Line: 2687."
    assert scratch_dtk._next_linker("GC/1.3.2", crash) == "GC/2.7"
    assert scratch_dtk._next_linker("GC/2.7", crash) is None  # nothing newer installed
    assert scratch_dtk._next_linker("GC/1.3.2", "### mwldeppc.exe Linker Error:\n#   undefined: __start") is None  # not a crash
    assert scratch_dtk._next_linker("GC/1.3.2", "build/GZ2E01/main.dol: \x1b[31mFAILED\x1b[39m") == "GC/2.7"  # links, other bytes
    assert scratch_dtk.comment_version("GC/2.7") == 11


def test_hand_written_code_cut_in_two_becomes_one_function(tmp_path):
    """dtk's first analysis of Mario Kart Wii cuts DWCi_Np_CPUCopyFast (0x800E941C, 0x984 bytes) in two and then can't
    read that back ("Overlapping functions 0x800E9D34-0x800E9DA0 -> 0x800E9D44"): the two become one function again,
    as in the community's project, and dtk analyses the whole game."""
    from decompnet.forks.scratch_dtk import _overlap_hint

    (tmp_path / "config" / "RMCP01").mkdir(parents=True)
    path = tmp_path / "config" / "RMCP01" / "symbols.txt"
    path.write_text("fn_800E9414 = .text:0x800E9414; // type:function size:0x8\n"
                    "fn_800E941C = .text:0x800E941C; // type:function size:0x918\n"
                    "fn_800E9D34 = .text:0x800E9D34; // type:function size:0x6C\n"
                    "fn_800E9DA0 = .text:0x800E9DA0; // type:function size:0x48\n", encoding="utf-8")
    tail = "Overlapping functions 3:0x800E9D34-3:0x800E9DA0 -> 3:0x800E9D44"
    assert _overlap_hint(tmp_path, "RMCP01", tail) == "0x800E941C"
    assert path.read_text(encoding="utf-8").splitlines() == [
        "fn_800E9414 = .text:0x800E9414; // type:function size:0x8",
        "fn_800E941C = .text:0x800E941C; // type:function size:0x984",
        "fn_800E9DA0 = .text:0x800E9DA0; // type:function size:0x48"]


def test_a_function_dtk_stops_short_of_is_declared_from_the_exception_table(tmp_path, monkeypatch):
    """RoadKill has zeroed words inside a real function at 0x8004C13C: dtk's analysis ends it there, then finds no
    function for the exception table's entry ("Failed to find function symbol"). The function is declared with the
    table's size, and the analysis runs again."""
    import struct

    from decompnet.forks import scratch_dtk

    text, index = 0x80004000, 0x80008000
    entries = struct.pack(">6I", 0x8004C000, 0x13C, 0x80007000, 0x8004C13C, 0x128, 0x80007008)
    dol = bytearray(0x100)
    struct.pack_into(">II", dol, 0, 0x100, 0x100 + 0x10)  # offsets: text section 0, data section 0 (index 7)
    struct.pack_into(">I", dol, 7 * 4, 0x110)
    struct.pack_into(">I", dol, 72, text)
    struct.pack_into(">I", dol, 72 + 7 * 4, index)
    struct.pack_into(">I", dol, 144, 0x10)
    struct.pack_into(">I", dol, 144 + 7 * 4, len(entries))
    dol += bytes(0x10) + entries
    monkeypatch.setattr(scratch_dtk, "_dtk_sections", lambda _: [(".text", 0x80004000, 0x50000),
                                                                  ("extabindex", index, len(entries))])
    (tmp_path / "config" / "GOCE5D").mkdir(parents=True)
    path = tmp_path / "config" / "GOCE5D" / "symbols.txt"
    path.write_text("lbl_8004C13C = .text:0x8004C13C; // type:label\n", encoding="utf-8")
    tail = ("Failed: While processing object 'main.dol' (module ID 0)\n\nCaused by:\n"
            "    Failed to find function symbol @ 3:0x8004C13C\nninja: error: rebuilding 'build.ninja': subcommand failed")
    assert scratch_dtk._declare_function(tmp_path, "GOCE5D", bytes(dol), tail) == ("0x8004C13C", 0x128)
    assert path.read_text(encoding="utf-8") == "fn_8004C13C = .text:0x8004C13C; // type:function size:0x128\n"
    assert scratch_dtk._declare_function(tmp_path, "GOCE5D", bytes(dol), tail) is None  # said once: no loop
    assert scratch_dtk._declare_function(tmp_path, "GOCE5D", bytes(dol), tail.replace("13C", "200")) is None  # not in the table


def _rel(module_id: int, imports: list[int]) -> bytes:
    """A minimal REL header (version 3, one section) with an import table naming `imports`."""
    imp = b"".join(struct.pack(">II", i, 0) for i in imports)
    head = struct.pack(">IIIIIIIIIIII", module_id, 0, 0, 1, 0x48, 0, 0, 3, 0, 0, 0x50, len(imp))
    return head.ljust(0x50, b"\0") + imp


def test_modules_that_need_a_module_the_disc_keeps_compressed_are_left_out_at_once(tmp_path):
    """#20: Sonic Adventure DX's event modules all import from a module the disc keeps compressed (SaCompGC), so
    decomp-toolkit stopped on one after another ("Failed to locate module 1") and the import gave up after 40
    analyses. Every module that needs the missing one goes in one step; the others stay."""
    from decompnet.forks import scratch_dtk

    gid, base = "GXSP8P", tmp_path / "orig" / "GXSP8P"
    (base / "files").mkdir(parents=True)
    for name, imports in (("ev000b", [0, 1]), ("ev000c", [0, 1, 7]), ("adv00", [0])):
        (base / "files" / f"{name}.rel").write_bytes(_rel(9, imports))
    assert scratch_dtk.rel_imports(_rel(9, [0, 1])) == {0, 1}
    assert scratch_dtk.is_compressed_rel(b"\0" * 8 + b"SaCompGC" + b"\0" * 64)
    cfg = tmp_path / "config" / gid / "config.yml"
    cfg.parent.mkdir(parents=True)
    cfg.write_text(f"object_base: orig/{gid}\nobject: sys/main.dol\nmodules:\n" + "".join(
        f"- object: files/{n}.rel\n  hash: 00\n  splits: config/{gid}/rels/{n}/splits.txt\n" for n in ("ev000b", "adv00", "ev000c")))
    tail = "Failed: Creating relocations for module ev000b\n\nCaused by:\n    Failed to locate module 1\n"
    assert scratch_dtk._drop_module(tmp_path, gid, tail) == ["ev000b", "ev000c"]
    text = cfg.read_text()
    assert "\n- object: files/adv00.rel" in text and "\n- object: files/ev000b.rel" not in text and "# - object: files/ev000c.rel" in text
