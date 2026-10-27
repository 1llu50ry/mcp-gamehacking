"""objdiff-cli: the community's diff engine, for every architecture it supports."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .. import toolchains
from ..network import NetworkError

KIND_MARK = {None: " ", "DIFF_NONE": " ", "DIFF_REPLACE": "|", "DIFF_DELETE": "<", "DIFF_INSERT": ">",
             "DIFF_OP_MISMATCH": "|", "DIFF_ARG_MISMATCH": "i"}

# How `objdiff-cli report generate` diffs (its base config, before the project's and unit's own options): progress
# reports, decomp.dev and this app's sync count a function as matched by these rules, where a relocation's target
# may have another name (the compiler's @91 for the original's lbl_802C2BD0). Every per-function diff uses them too,
# so a match is a match everywhere; with objdiff's interactive defaults the same function would read 99.9%.
REPORT_OPTIONS = {"functionRelocDiffs": "none", "combineDataSections": True, "combineTextSections": True,
                  "ppc.calculatePoolRelocations": False}
# Symbol names compilers make up for literals and pools, which never have to match the original's names.
_GENERATED = re.compile(r"^(@\d+|\$LC\d+|_\$E\d+|\.\.\..*|@stringBase\d*|\.L.*)$")


class ObjdiffError(NetworkError):
    pass


def _exe(log=print) -> str:
    toolchains.ensure("objdiff-cli", log=log)
    return str(toolchains.binary("objdiff-cli"))


def judge_options(project_options: dict | None = None, unit_options: dict | None = None) -> dict:
    """The diff settings the progress report uses for a unit: the report's own, then the project's, then the unit's."""
    return {**REPORT_OPTIONS, **(project_options or {}), **(unit_options or {})}


def _run(args: list[str], cwd: Path, timeout: float = 600) -> str:
    res = subprocess.run([_exe(), "--no-color", *args], cwd=cwd, capture_output=True, text=True, timeout=timeout,
                         encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise ObjdiffError((res.stderr or res.stdout).strip()[-1500:] or f"objdiff-cli exited with {res.returncode}")
    return res.stdout


def report(project: Path, out: Path) -> dict:
    """Progress report (objdiff report.proto as JSON) for a project with an objdiff.json.

    objdiff-cli stops at the first unit whose compiled object is missing (work-in-progress source that doesn't
    compile yet, or that the project's default build never compiles). Those units are measured from the game's
    object alone, as not matched yet, the way the projects' own report scripts do it."""
    cfg = json.loads((project / "objdiff.json").read_text(encoding="utf-8"))
    missing = [u for u in cfg.get("units", []) if u.get("base_path") and not (project / u["base_path"]).is_file()]
    if not missing:
        _run(["report", "generate", "-p", str(project), "-o", str(out)], cwd=project, timeout=1800)
        return json.loads(out.read_text(encoding="utf-8"))
    for unit in cfg.get("units", []):
        for key in ("target_path", "base_path"):
            if unit.get(key):
                unit[key] = str((project / unit[key]).resolve())
    for unit in missing:
        del unit["base_path"]
    with tempfile.TemporaryDirectory(prefix="decompwtf-report-") as tmp:
        (Path(tmp) / "objdiff.json").write_text(json.dumps(cfg), encoding="utf-8")
        _run(["report", "generate", "-p", tmp, "-o", str(out.resolve())], cwd=project, timeout=1800)
    return json.loads(out.read_text(encoding="utf-8"))


@dataclass
class FunctionDiff:
    symbol: str | None
    match_percent: float | None  # None: the function isn't in the base object (not written yet)
    rows: list[tuple[str, str, str]]  # (marker, target, base)
    target_size: int
    unit_scores: dict[str, float | None]  # every function in the unit -> match % (None: not in your build)
    order: list[str]  # the unit's functions in target address order
    ops: dict[str, list[str]]  # the unit's functions -> target mnemonics (for finding look-alikes)
    # (original, yours) symbol names of references that point at differently named things: objdiff's rules accept
    # them, but the game's link resolves names, so they're worth fixing before the code goes upstream
    renamed: list[tuple[str, str]] = field(default_factory=list)
    literals: list = field(default_factory=list)  # literals.Mismatch: constants that differ although the code matches

    @property
    def matched(self) -> bool:
        return self.match_percent is not None and self.match_percent >= 100.0 and not self.literals

    def literals_note(self) -> str:
        if not self.literals:
            return ""
        listing = "\n".join(f"- {m.describe()}" for m in self.literals[:6])
        return ("NOT A MATCH YET: every instruction matches, but constants it loads differ from the original's:\n"
                f"{listing}\nWrite the literal with the original's value (float vs double, the exact digits).")

    def target_asm(self) -> str:
        return "\n".join(t for _, t, _ in self.rows if t)

    def render(self, context: int = 2, max_rows: int = 60) -> str:
        from ..scoring import render_rows

        return render_rows(self.rows, context, max_rows, legend="markers: |=different instruction i=operand differs "
                           "<=missing (target only) >=extra (yours only)")


def _sym(obj: dict | None, name: str) -> dict | None:
    for s in (obj or {}).get("symbols", []):
        if s.get("name") == name:
            return s
    return None


def _fmt(row: dict) -> str:
    ins = row.get("instruction")
    return ins.get("formatted", "") if ins else ""


def _option(value) -> str:
    return str(value).lower() if isinstance(value, bool) else str(value)


def _reloc_name(side: dict | None, row: dict) -> str | None:
    ins = row.get("instruction") or {}
    rel = ins.get("relocation")
    syms = (side or {}).get("symbols", [])
    if rel is None:
        return None
    idx = int(rel.get("target_symbol") or 0)
    return syms[idx].get("name") if 0 <= idx < len(syms) else None


def _renamed(left: dict | None, right: dict | None, lrows: list[dict], rrows: list[dict]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for lr, rr in zip(lrows, rrows, strict=False):
        a, b = _reloc_name(left, lr), _reloc_name(right, rr)
        if a and b and a != b and not _GENERATED.match(a) and not _GENERATED.match(b) and (a, b) not in out:
            out.append((a, b))
    return out


def diff(target: Path | None, base: Path | None, symbol: str | None, cwd: Path, options: dict | None = None,
         project: Path | None = None, unit: str | None = None) -> FunctionDiff:
    """Diff one function between the target (expected) and base (yours) objects; symbol None measures the whole
    unit (unit_scores) without one function's rows.

    `options` are the settings to diff with (judge_options: the progress report's), so percentages agree with the
    report. With `project` and `unit`, objdiff reads the unit from objdiff.json, symbol mappings included."""
    args = ["diff", "-o", "-", "--format", "json"]
    for key, value in (options or {}).items():
        args += ["-c", f"{key}={_option(value)}"]
    if project is not None and unit and base is not None and base.exists():
        args += ["-p", str(project), "-u", unit]
    else:
        if target is not None and target.exists():
            args += ["-1", str(target)]
        if base is not None and base.exists():
            args += ["-2", str(base)]
    data = json.loads(_run([*args, *([symbol] if symbol else [])], cwd=cwd, timeout=120))
    left, right = _sym(data.get("left"), symbol), _sym(data.get("right"), symbol)
    if left is None and symbol is not None:
        raise ObjdiffError(f"{symbol} isn't in the target object")
    left = left or {}
    lrows = left.get("instructions", [])
    rrows = right.get("instructions", []) if right else []
    rows = []
    for k in range(max(len(lrows), len(rrows))):
        lr = lrows[k] if k < len(lrows) else {}
        rr = rrows[k] if k < len(rrows) else {}
        kind = lr.get("diff_kind") or rr.get("diff_kind")
        rows.append((KIND_MARK.get(kind, "|"), _fmt(lr), _fmt(rr)))
    pct = right.get("match_percent", left.get("match_percent")) if right else None
    if symbol is None:
        right = None
    if right is not None and pct is None:
        pct = 100.0 if all(m == " " for m, _, _ in rows) else 0.0
    built = {s.get("name") for s in (data.get("right") or {}).get("symbols", [])}
    funcs = [s for s in (data.get("left") or {}).get("symbols", []) if s.get("kind") == "SYMBOL_FUNCTION"]
    scores = {s["name"]: (float(s["match_percent"]) if s.get("match_percent") is not None and s["name"] in built else None)
              for s in funcs}
    order = [s["name"] for s in sorted(funcs, key=lambda s: int(s.get("address") or 0))]
    ops = {s["name"]: [r["instruction"]["formatted"].split(None, 1)[0] for r in s.get("instructions", [])
                       if r.get("instruction") and r["instruction"].get("formatted")] for s in funcs}
    renamed = _renamed(data.get("left"), data.get("right"), lrows, rrows) if right is not None else []
    wrong = []
    if pct is not None and float(pct) >= 100.0 and target is not None and base is not None and base.exists():
        from . import literals

        insns, at = [], 0
        for r in lrows:
            ins = r.get("instruction") or {}
            if ins.get("formatted"):
                insns.append((at, ins["formatted"].split(None, 1)[0]))
            at += int(ins.get("size") or 4)
        wrong = literals.mismatches(target, base, symbol, insns)
    return FunctionDiff(symbol, float(pct) if pct is not None else None, rows, int(left.get("size", 0)), scores, order, ops,
                        renamed, wrong)
