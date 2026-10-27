"""Machine-made first drafts for functions of a fork that are still assembly.

Community projects keep the assembly of undecompiled functions in the tree: splat projects one file per
function (`asm/nonmatchings/<file>/<function>.s`, referenced by `INCLUDE_ASM`), dtk projects one file per
unit under `build/<version>/asm/`. m2c turns that into a C draft for MIPS (N64, PS1, PS2), PowerPC
(GameCube, Wii), ARM and Thumb (GBA, DS).
"""

from __future__ import annotations

import re
import subprocess
import threading
from pathlib import Path

from .. import seeds, toolchains

# platform -> m2c target, without the language
M2C = {"n64": "mips", "ps": "mipsel-gcc", "psp": "mipsel-gcc", "ps2": "mipsee-gcc", "gc": "ppc-mwcc",
       "wii": "ppc-mwcc", "gba": "gba", "nds": "arm", "3ds": "arm"}
MAX_ASM = 2 * 1024 * 1024


def supported(platform: str) -> bool:
    return platform in M2C


def find_asm(root: Path, unit_name: str, symbol: str, source_text: str | None) -> Path | None:
    """The assembly file holding `symbol`, if the project has one."""
    if source_text:
        m = re.search(rf'INCLUDE_ASM\(\s*"([^"]+)"\s*,\s*{re.escape(symbol)}\s*\)', source_text)
        if m and (root / m.group(1) / f"{symbol}.s").is_file():
            return root / m.group(1) / f"{symbol}.s"
        m = re.search(rf'GLOBAL_ASM\(\s*"([^"]*/{re.escape(symbol)}\.s)"\s*\)', source_text)
        if m and (root / m.group(1)).is_file():
            return root / m.group(1)
    for base in (root / "asm" / "nonmatchings", root / "asm"):
        if base.is_dir():
            for hit in base.rglob(f"{symbol}.s"):
                return hit
    # dtk: build/<version>/asm/<unit path>.s, unit names being "<module>/<path>"
    parts = unit_name.split("/")
    for asm_root in root.glob("build/*/asm"):
        for rel in ("/".join(parts), "/".join(parts[1:])):
            if rel and (asm_root / f"{rel}.s").is_file():
                return asm_root / f"{rel}.s"
    return None


def _block(text: str, symbol: str) -> str:
    """Just one function from a large dtk assembly file."""
    m = re.search(rf"^\.fn {re.escape(symbol)}\b.*?^\.endfn {re.escape(symbol)}\b.*?$", text, re.MULTILINE | re.DOTALL)
    return m.group(0) if m else text


def draft(root: Path, platform: str, unit_name: str, symbol: str, source_path: str | None,
          compiler_hint: str = "", timeout: float = 30, valid: bool = False) -> str | None:
    """m2c's draft of one function; `valid`: in a form that compiles (m2c's macros for what it couldn't tell, which
    from-scratch projects define in common.h)."""
    target = M2C.get(platform)
    if not target or toolchains.installed("m2c") is None:
        return None
    src = root / source_path if source_path else None
    source_text = src.read_text(errors="replace", encoding="utf-8") if src and src.exists() else None
    asm = find_asm(root, unit_name, symbol, source_text)
    lang = "c++" if source_path and Path(source_path).suffix.lower() in (".cpp", ".cc", ".cxx", ".cp") else "c"
    if asm is None and platform == "nds":  # ds-decomp keeps code as objects: its own disassembly, per source file
        block = _dsd_block(root, unit_name, symbol)
        if block is None:
            return None
        text, thumb = block
        return seeds.run_m2c(text, symbol, f"{'gba' if thumb else 'arm'}-mwcc-{lang}", timeout=timeout, valid=valid)
    if asm is None:
        return None
    text = asm.read_text(errors="replace", encoding="utf-8")
    if len(text) > MAX_ASM or ".fn " in text:
        text = _block(text, symbol)
    if platform == "n64":
        target += "-ido" if "ido" in compiler_hint.lower() else "-gcc"
    return seeds.run_m2c(text, symbol, f"{target}-{lang}", timeout=timeout, valid=valid)


_DSD_LOCK = threading.Lock()


def _dsd_asm(root: Path) -> Path | None:
    """`dsd dis` of a ds-decomp project (one .s per source file), made again when its splits change."""
    from .project import STATE

    configs = sorted(root.glob("config/*/arm9/config.yaml"))
    if not configs or toolchains.installed("dsd") is None:
        return None
    out = root / STATE / "dsd-asm"
    stamp = out / ".made"
    newest = max((p.stat().st_mtime for p in root.glob("config/**/*.txt")), default=0)
    with _DSD_LOCK:
        if not stamp.exists() or stamp.stat().st_mtime < newest:
            subprocess.run([str(toolchains.binary("dsd")), "dis", "-c", str(configs[0].relative_to(root)), "-a",
                            str(out)], cwd=root, capture_output=True, timeout=600)
            out.mkdir(parents=True, exist_ok=True)
            stamp.touch()
    return out


def _dsd_block(root: Path, unit_name: str, symbol: str) -> tuple[str, bool] | None:
    """(the function's assembly as m2c reads it, is Thumb) from ds-decomp's disassembly."""
    asm = _dsd_asm(root)
    path = asm / f"{unit_name}.s" if asm else None
    if path is None or not path.is_file():
        return None
    text = path.read_text(errors="replace", encoding="utf-8")
    m = re.search(rf"^\s*(arm|thumb)_func_start {re.escape(symbol)}\n(.*?)^\s*\1_func_end {re.escape(symbol)}\b",
                  text, re.MULTILINE | re.DOTALL)
    if not m:
        return None
    body = re.sub(r"\s*;.*$", "", m.group(2), flags=re.MULTILINE)  # dsd's comments (addresses)
    lines = [ln for ln in body.splitlines() if ln.strip() and not ln.strip().startswith(f"{symbol}:")]
    return f".text\nglabel {symbol}\n" + "\n".join(lines) + "\n", m.group(1) == "thumb"


def add_m2c_macros(header: Path) -> bool:
    """The macros compilable drafts use (M2C_FIELD, M2C_UNK...), added to a from-scratch project's common header.
    False when they're there already."""
    try:
        text = header.read_text(encoding="utf-8")
    except OSError:
        return False
    if "M2C_DEFINES" in text:
        return False
    block = "\n/* What machine drafts (m2c) use for what they can't tell yet: autopilot tries them as they are. */\n" \
            + seeds.M2C_MACROS
    end = text.rstrip().rfind("#endif")
    text = text[:end] + block + "\n" + text[end:] if end >= 0 else text.rstrip("\n") + "\n" + block
    header.write_text(text, encoding="utf-8")
    return True


_DECL = re.compile(r"^[A-Za-z_][^;{}=]*;\s*(?:/\*.*\*/)?$")  # a declaration: no body, no initializer


def self_contained(text: str, span: tuple[int, int], file_text: str = "") -> str:
    """One function out of an m2c draft, as a definition that compiles on its own in its file: what m2c declares
    outside it (the globals and functions it uses) goes inside, at the top of its body, where C and C++ allow
    declarations too. Data m2c would define (`static`) is only declared. Names the file declares already (with
    their real types, often) are left to it."""
    code = text[span[0]:span[1]]
    decls = []
    for line in (text[:span[0]] + "\n" + text[span[1]:]).splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "//", "/*")) or not _DECL.match(line):
            continue
        line = re.sub(r"/\*.*\*/\s*$", "", line).strip()
        line = re.sub(r"^static\s+", "extern ", line)
        name = re.search(r"(\w+)\s*(?:\(|\[|;)", line)
        if name and file_text and re.search(rf"\b{re.escape(name.group(1))}\b", file_text):
            continue
        if "(" in line or line.startswith("extern "):
            decls.append(line)
        else:
            decls.append("extern " + line)
    brace = code.find("{")
    if brace < 0 or not decls:
        return code
    return code[:brace + 1] + "\n" + "".join(f"    {d}\n" for d in dict.fromkeys(decls)) + code[brace + 1:].lstrip("\n")
