"""Export a PC matching project as a normal IDE/CMake project plus a match judge.

This deliberately does not invent a PE linker. It writes one source file per matched function, the shared
context header, CMake project files, compile_commands.json for clangd/IDE indexing, and judge.py, which
compiles a function with the project's compiler and compares it with the original bytes after the same
relocation normalization the matcher uses. Unmatched functions stay in the target; use the app's match loop
until they have C.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

from .. import toolchains
from ..project import compiler_config
from . import elfexe, pe
from .symbols import IDENT

PC_PLATFORMS = ("windows", "linux")


class ExportPcError(RuntimeError):
    pass


def _ext(platform: str) -> str:
    return ".exe" if platform == "windows" else ".elf"


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_") or "function"


def _language(cfg: dict) -> tuple[str, str]:
    tc = cfg["compiler"].get("toolchain", "")
    cxx = tc.startswith(("gxx-", "clangxx-", "mingwxx-", "clang-clxx-"))
    return ("CXX", ".cpp") if cxx else ("C", ".c")


def export_pc(net, slug: str, out: Path, log=print) -> dict:
    proj = net._project(slug)
    cfg = net.cfg(proj)
    platform = cfg.get("platform")
    if platform not in PC_PLATFORMS:
        raise ExportPcError(f"PC export is for Windows and Linux programs, not {platform}")
    root = Path(proj["root"])
    image_name = cfg.get("rom", {}).get("program") or cfg.get("rom", {}).get("file")
    if not image_name:
        raise ExportPcError("this project has no target program")
    target = root / image_name
    if not target.is_file():
        raise ExportPcError(f"the target is missing: {target}")
    data = target.read_bytes()
    image = (elfexe if platform == "linux" else pe).read(data, target.name)
    sources = net.store.all(
        "SELECT name, vram, rom_offset, size, matched_source FROM functions "
        "WHERE project_id=? AND status='matched' AND matched_source IS NOT NULL AND matched_source!='' "
        "ORDER BY vram", proj["id"])
    if not sources:
        raise ExportPcError("no matched functions yet: match at least one function before exporting")

    if out.exists():
        for child in out.iterdir():
            if child.name != ".git":
                shutil.rmtree(child) if child.is_dir() else child.unlink()
    out.mkdir(parents=True, exist_ok=True)
    (out / "src").mkdir(exist_ok=True)
    (out / "include").mkdir(exist_ok=True)
    context = net._context(proj["id"])["header"]
    (out / "include" / "context.h").write_text(context, encoding="utf-8")
    (out / ("baserom" + _ext(platform))).write_bytes(data)

    lang, ext = _language(cfg)
    funcs = []
    used: set[str] = set()
    for row in sources:
        name = row["name"]
        if not IDENT.match(name):
            log(f"skipping {name}: not a simple C identifier")
            continue
        stem = _safe(name)
        if stem in used:
            stem = f"{stem}_{row['vram']:08X}"
        used.add(stem)
        src = out / "src" / f"{stem}{ext}"
        src.write_text(f'#include "context.h"\n\n{row["matched_source"].strip()}\n', encoding="utf-8")
        funcs.append({"name": name, "source": src.relative_to(out).as_posix(), "vram": int(row["vram"]),
                      "rom": int(row["rom_offset"]), "size": int(row["size"] or 0)})
    if not funcs:
        raise ExportPcError("the matched functions have names that aren't simple C identifiers to export")

    symbols = {}
    for s in net.symbols(proj["id"]).by_name.values():
        if IDENT.match(s.name):
            symbols.setdefault(s.name, s.address)
    build = {
        "title": proj["name"], "platform": platform, "arch": image.arch, "language": lang,
        "image": f"baserom{_ext(platform)}", "sha1": hashlib.sha1(data).hexdigest(),
        "compiler": cfg["compiler"], "functions": funcs, "symbols": symbols,
    }
    (out / "build.json").write_text(json.dumps(build, indent=1), encoding="utf-8")

    # CMake project: ordinary sources, ordinary flags. The IDE owns the build.
    flags = cfg["compiler"].get("flags") or toolchains.get(cfg["compiler"]["toolchain"]).flags
    cmake_flags = " ".join(json.dumps(f) for f in flags)
    cmake = f"""cmake_minimum_required(VERSION 3.20)
project({json.dumps(proj['name'])} LANGUAGES C CXX)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
file(GLOB SOURCES CONFIGURE_DEPENDS "src/*{ext}")
add_library(decomp OBJECT ${{SOURCES}})
target_include_directories(decomp PRIVATE include)
target_compile_options(decomp PRIVATE {cmake_flags})
"""
    (out / "CMakeLists.txt").write_text(cmake, encoding="utf-8")

    # compile_commands.json is what clangd and many IDEs need before CMake has been configured.
    try:
        cc = compiler_config(out, {"compiler": cfg["compiler"]})
        commands = []
        for f in funcs:
            obj = f"build/{Path(f['source']).with_suffix('.o').as_posix()}"
            args = [a.replace("{src}", f["source"]).replace("{obj}", obj).replace("{include}", "include")
                    for a in cc.cmd]
            commands.append({"directory": str(out), "file": f["source"], "arguments": args})
        (out / "compile_commands.json").write_text(json.dumps(commands, indent=1), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        log(f"could not write compile_commands.json: {e}")

    shutil.copyfile(Path(__file__).with_name("export_pc_judge.py"), out / "judge.py")
    (out / ".gitignore").write_text("build/\nbaserom*\n", encoding="utf-8")
    (out / "README.md").write_text(f"""# {proj['name']} (PC matching project)

A normal CMake source tree for the functions that already match, with a small judge. It is meant to be
opened in your IDE (VS Code, CLion, Visual Studio, ...), not rebuilt inside decomp.anything.

- `src/` — matched functions as C/C++, one per file.
- `include/context.h` — shared types, structs and prototypes.
- `CMakeLists.txt`, `compile_commands.json` — configure it with your IDE or CMake; exact compiler flags are
  already in the project.
- `judge.py` — `python judge.py <function>` compiles one function with the project's compiler and compares it
  with the original bytes after relocation normalization. `python judge.py --all` checks every exported one.
- `baserom...` — your own copy of the target. It stays out of git; judge.py reads it.

This does **not** relink a PE/ELF: link the program in your normal toolchain/IDE, or keep using decomp.anything
for the matching loop. The target's unmatched functions are still in your copy and in decomp.anything.

`build/` and `baserom*` are generated/private.
""", encoding="utf-8")
    return {"path": str(out), "identical": None, "matched": len(funcs), "functions": len(funcs),
            "kind": "pc", "compile_commands": str(out / "compile_commands.json"),
            "judge": str(out / "judge.py"), "log": f"wrote {len(funcs)} matched functions"}
