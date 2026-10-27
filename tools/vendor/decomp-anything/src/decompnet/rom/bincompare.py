"""Compare two builds of the same PC program, function by function.

A patch, a demo, or a port moves code around and changes a few functions. Comparing raw addresses
would call every function new. This compares *normalized instructions* instead: relocation fields
(calls, globals, RIP-relative loads) are blanked, so a function that only moved still looks the same;
branch targets inside a function stay relative; the remaining instruction text is the fingerprint.

Exact fingerprints are paired first, then look-alikes (difflib over the instruction sequence) for
functions an optimizer changed. The result is a triage list: same, changed, added and removed.
"""

from __future__ import annotations

import difflib
import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from .. import scoring
from ..elfobj import FunctionObj, Reloc
from . import elfexe, pe


@dataclass
class VersionFunction:
    name: str
    address: int
    size: int
    lines: list[str] = field(default_factory=list)
    fingerprint: str = ""
    exact: bool = True


@dataclass
class Version:
    path: str
    kind: str
    arch: str
    functions: list[VersionFunction]


class CompareError(ValueError):
    pass


def _read(path: str | Path) -> Version:
    p = Path(path).expanduser()
    if not p.is_file():
        raise CompareError(f"no file at {p}")
    data = p.read_bytes()
    if pe.is_pe(data):
        image = pe.read(data, p.name)
        kind = "PE"
    elif elfexe.is_x86_elf(data):
        image = elfexe.read(data, p.name)
        kind = "ELF"
    else:
        raise CompareError(f"{p.name} isn't a Windows PE or Linux x86 program; version comparison currently "
                           f"covers PC programs")
    functions = []
    for f in image.functions:
        functions.append(VersionFunction(f.name, f.vram, len(f.code), *_normalized(f, image.arch)))
    functions.sort(key=lambda f: f.address)
    return Version(str(p), kind, image.arch, functions)


def _normalized(fn, arch: str) -> tuple[list[str], str]:
    """Instruction text with every address the target encodes replaced by `<ref>`."""
    relocs = [Reloc(field, rtype, "<ref>", 0) for field, rtype, _addr, _end in getattr(fn, "refs", [])]
    obj = FunctionObj(fn.name, arch, False, fn.code, relocs, format="coff")
    try:
        lines = [ins.text for ins in scoring.disassemble(obj)]
    except Exception:  # noqa: BLE001
        lines = []
    if not lines:
        lines = [fn.code.hex()]
    text = "\n".join(lines)
    return lines, hashlib.sha256(text.encode()).hexdigest()


def compare_paths(old_path: str | Path, new_path: str | Path, *, old_names: dict[int, str] | None = None,
                  threshold: float = 0.82) -> dict:
    old, new = _read(old_path), _read(new_path)
    if old.arch != new.arch:
        raise CompareError(f"the programs are different architectures: {old.arch} and {new.arch}")
    if old_names:
        for fn in old.functions:
            if fn.address in old_names:
                fn.name = old_names[fn.address]
    rows = _match(old.functions, new.functions, threshold)
    same = sum(1 for r in rows if r["status"] == "same")
    changed = sum(1 for r in rows if r["status"] == "changed")
    added = sum(1 for r in rows if r["status"] == "added")
    removed = sum(1 for r in rows if r["status"] == "removed")
    moved = sum(1 for r in rows if r["status"] == "same" and r["address"] != r["other_address"])
    return {
        "old": {"path": old.path, "kind": old.kind, "arch": old.arch, "functions": len(old.functions)},
        "new": {"path": new.path, "kind": new.kind, "arch": new.arch, "functions": len(new.functions)},
        "summary": {"functions": len(old.functions), "same": same, "moved": moved, "changed": changed,
                    "added": added, "removed": removed},
        "rows": rows,
    }


def _match(old: list[VersionFunction], new: list[VersionFunction], threshold: float) -> list[dict]:
    """Pair exact fingerprints, then same names, then instruction-sequence look-alikes."""
    used_new: set[int] = set()
    paired: dict[int, int] = {}
    by_fp: dict[str, list[int]] = {}
    for i, fn in enumerate(new):
        by_fp.setdefault(fn.fingerprint, []).append(i)
    for i, fn in enumerate(old):
        bucket = by_fp.get(fn.fingerprint)
        if bucket:
            j = next((k for k in bucket if k not in used_new), bucket[0])
            if j not in used_new:
                paired[i] = j
                used_new.add(j)

    # Same symbol name is strong evidence when a function's code changed.
    by_name: dict[str, list[int]] = {}
    for j, fn in enumerate(new):
        if j not in used_new:
            by_name.setdefault(fn.name, []).append(j)
    for i, fn in enumerate(old):
        if i in paired:
            continue
        bucket = by_name.get(fn.name)
        if bucket:
            j = next((k for k in bucket if k not in used_new), None)
            if j is not None:
                paired[i] = j
                used_new.add(j)

    # Instruction sequence look-alikes. Block by instruction count so this stays linear-ish on big programs.
    left_old = [i for i in range(len(old)) if i not in paired]
    left_new = [j for j in range(len(new)) if j not in used_new]
    if left_old and left_new and len(left_old) * len(left_new) <= 400_000:
        candidates = []
        for i in left_old:
            a = old[i]
            for j in left_new:
                b = new[j]
                n = max(len(a.lines), len(b.lines), 1)
                if abs(len(a.lines) - len(b.lines)) > max(8, n // 4):
                    continue
                ratio = difflib.SequenceMatcher(None, a.lines, b.lines, autojunk=False).ratio()
                if ratio >= threshold:
                    candidates.append((ratio, i, j))
        candidates.sort(reverse=True)
        for _, i, j in candidates:
            if i not in paired and j not in used_new:
                paired[i] = j
                used_new.add(j)

    rows: list[dict] = []
    for i, a in enumerate(old):
        j = paired.get(i)
        if j is None:
            rows.append(_row(a, None, "removed", 0.0))
            continue
        b = new[j]
        exact = a.fingerprint == b.fingerprint
        ratio = 1.0 if exact else _ratio(a, b)
        rows.append(_row(a, b, "same" if exact else "changed", ratio))
    for j, b in enumerate(new):
        if j not in used_new:
            rows.append(_row(None, b, "added", 0.0))
    rows.sort(key=lambda r: (r["address"] if r["address"] is not None else r["other_address"] or 0))
    return rows


def _ratio(a: VersionFunction, b: VersionFunction) -> float:
    return round(difflib.SequenceMatcher(None, a.lines, b.lines, autojunk=False).ratio(), 3)


def _row(a: VersionFunction | None, b: VersionFunction | None, status: str, ratio: float) -> dict:
    return {
        "name": a.name if a else "",
        "address": a.address if a else None,
        "size": a.size if a else None,
        "other_name": b.name if b else "",
        "other_address": b.address if b else None,
        "other_size": b.size if b else None,
        "status": status,
        "similarity": ratio,
    }
