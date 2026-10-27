"""Local tools for hash-only projects.

In a hash-only project the coordinator keeps only one-way fingerprints of the original code. Contributors
disassemble and diff against their *own* lawful copy on their own machine, then submit to the coordinator,
which answers match / no match. Nothing copyrighted ever has to be hosted.
"""

from __future__ import annotations

from pathlib import Path

from . import scoring, toolchains
from .compiler import compile_source
from .elfobj import extract_function
from .project import compiler_config


def asm(obj: Path, function: str) -> str:
    fn = extract_function(obj.read_bytes(), function)
    if fn is None:
        raise SystemExit(f"{obj} has no function {function!r}")
    return scoring.asm_text(fn)


def fingerprint(obj: Path, function: str) -> str:
    fn = extract_function(obj.read_bytes(), function)
    if fn is None:
        raise SystemExit(f"{obj} has no function {function!r}")
    return fn.fingerprint()


def diff(obj: Path, function: str, source: Path, toolchain: str, context: Path | None = None,
         flags: list[str] | None = None, include_dirs: list[Path] = ()) -> str:
    target = extract_function(obj.read_bytes(), function)
    if target is None:
        raise SystemExit(f"{obj} has no function {function!r}")
    compiler = {"toolchain": toolchains.get(toolchain).id, "include_dirs": [str(d.resolve()) for d in include_dirs]}
    if flags:
        compiler["flags"] = flags
    cc = compiler_config(Path("."), {"compiler": compiler})  # on Windows, Linux-only toolchains go through WSL
    res = compile_source(cc, context.read_text(encoding="utf-8") if context else "", source.read_text(encoding="utf-8"))
    if not res.ok:
        return f"COMPILE ERROR\n{res.log}"
    cand = extract_function(res.obj, function)
    if cand is None:
        return f"compiled, but there is no function named {function!r}"
    d = scoring.diff(target, cand)
    head = ("MATCH (submit it to the coordinator with compile_and_diff)" if d.bytes_match
            else f"score {d.score} ({scoring.percent_text(d.percent)})")
    return f"{head}\n{d.render()}"
