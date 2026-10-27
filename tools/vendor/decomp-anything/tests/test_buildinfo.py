"""What a PC binary says about the language, compiler and version that built it."""

from decompnet.rom import buildinfo


def test_gcc_comment_is_the_c_compiler():
    info = buildinfo.analyze(b"", comment=b"GCC: (Ubuntu 13.2.0-23ubuntu4) 13.2.0", cxx=False)
    assert info["language"] == "C" and info["compiler"] == "GCC" and info["version"] == "13.2.0"
    assert info["label"] == "C (GCC 13.2.0)" and info["matchable"]


def test_clang_comment_wins_over_the_libc_gcc_line():
    comment = (b"GCC: (Ubuntu 13.2.0-23ubuntu4) 13.2.0\0"
               b"clang version 18.1.3 (https://github.com/llvm/llvm-project)\0")
    info = buildinfo.analyze(b"", comment=comment, cxx=True)
    assert info["language"] == "C++" and info["compiler"] == "Clang" and info["version"] == "18.1.3"


def test_rustc_comment():
    info = buildinfo.analyze(b"", comment=b"rustc version 1.80.1 (3f5fd8dd4 2024-08-06)", cxx=True)
    assert info["language"] == "Rust" and info["version"] == "1.80.1"
    assert not info["matchable"] and info["label"] == "Rust 1.80.1"


def test_stripped_rust_keeps_the_release_in_standard_library_paths():
    data = b"/build/rustc-1.93-DHHnHq/rustc-1.93-1.93.1+dfsg/library/std/src/io.rs"
    info = buildinfo.analyze(data, cxx=True)
    assert info["language"] == "Rust" and info["version"] == "1.93.1"


def test_go_buildinfo_has_the_exact_toolchain_version():
    info = buildinfo.analyze(b"", buildinfo=b"\xff Go buildinf:\x08\x02go1.22.3", cxx=False)
    assert info["language"] == "Go" and info["compiler"] == "go" and info["version"] == "1.22.3"
    assert info["label"] == "Go 1.22.3" and not info["matchable"]


def test_msvc_reports_the_linker_version():
    info = buildinfo.analyze(b"", cxx=True, linker="14.44")
    assert info["language"] == "C++" and info["compiler"] == "MSVC" and info["version"] == "14.44"
    assert info["release"] == "Visual C++ 2022" and info["label"] == "C++ (Visual C++ 2022)"


def test_visual_cpp_5_comes_from_its_linker_version_and_runtime_names():
    data = b"??2@YAPAXI@Z\0.?AVtype_info@@\0"
    info = buildinfo.analyze(data, cxx=buildinfo.looks_cxx([], data), linker="5.10")
    assert info["language"] == "C++" and info["release"] == "Visual C++ 5.0"
    assert info["label"] == "C++ (Visual C++ 5.0)"


def test_msvc_flags_follow_security_exceptions_and_rtti():
    data = b"__security_cookie\0__CxxFrameHandler3\0.?AVtype_info@@\0"
    got = buildinfo.infer_flags(data, compiler="MSVC", cxx=True, base_flags=["/O2", "/GS-", "/TC"])
    assert got["flags"] == ["/O2", "/TC", "/GS", "/EHsc", "/GR"]
    assert any("security cookie" in x for x in got["evidence"])
    assert any("frame handlers" in x for x in got["evidence"])


def test_msvc_c_does_not_get_cpp_flags():
    got = buildinfo.infer_flags(b"", compiler="MSVC", cxx=False, base_flags=["/O2", "/GS-"])
    assert got["flags"] == ["/O2", "/GS-"]


def test_gnu_flags_adjust_the_toolchain_defaults():
    base = ["-O2", "-fno-stack-protector", "-fno-asynchronous-unwind-tables", "-fno-ident"]
    got = buildinfo.infer_flags(b"", compiler="GCC", cxx=False, base_flags=base,
                                section_names=[".text", ".eh_frame", ".comment"], comment=b"GCC: (x) 1.0")
    assert "-fno-stack-protector" in got["flags"] and "-mno-stack-arg-probe" in got["flags"]
    assert "-fno-asynchronous-unwind-tables" not in got["flags"]
    assert "-fno-ident" not in got["flags"]


def test_gnu_cpp_without_rtti_or_exceptions_says_so():
    got = buildinfo.infer_flags(b"", compiler="GCC", cxx=True, base_flags=["-O2"])
    assert "-fno-exceptions" in got["flags"] and "-fno-rtti" in got["flags"]
