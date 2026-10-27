"""Donated compute, volunteer side: `decompnet worker`.

Fetches a near-matching function from the coordinator, randomly rewrites the best known C source in ways
that keep its meaning but change code generation (statement order, declaration order, casts, comparison
forms, increment styles, `register`), compiles every variant locally with the same pinned toolchain, scores
it with the same scorer, and submits improvements. The coordinator re-verifies everything it receives.

Runs only GPL-licensed toolchains automatically; proprietary ones are used only if you installed them.
"""

from __future__ import annotations

import base64
import json
import random
import re
import tempfile
import time
import urllib.request
from pathlib import Path

from . import scoring, toolchains
from .compiler import compile_source
from .elfobj import FunctionObj, Reloc, extract_function
from .project import compiler_config

TYPES_32 = ["int", "unsigned", "unsigned int", "long", "unsigned long", "s32", "u32", "uInt", "uLong"]
CASTS = ["(int)", "(unsigned)", "(s32)", "(u32)", "(uInt)", "(uLong)", "(short)", "(unsigned short)"]
_DECL = re.compile(r"^(\s+)(register\s+)?((?:unsigned\s+|signed\s+)?\w+)(\s*\**\s*)(\w+)(\s*(?:=[^;]*)?;)\s*$")
_STMT = re.compile(r"^\s+[^\s{}#][^{}]*;\s*$")
# statements that transfer control (or open blocks) are never moved; one-line `if (c) x;` statements may be
_CONTROL = re.compile(r"\b(return|break|continue|goto|case|default)\b|^\s*(else|for|while|do|switch)\b")


def _body_bounds(lines: list[str]) -> tuple[int, int]:
    start = next((i for i, ln in enumerate(lines) if "{" in ln), 0)
    end = max((i for i, ln in enumerate(lines) if ln.strip().startswith("}")), default=len(lines) - 1)
    return start + 1, end


def _swap_statements(lines, rng):
    lo, hi = _body_bounds(lines)
    pairs = [i for i in range(lo, hi - 1) if _STMT.match(lines[i]) and _STMT.match(lines[i + 1])
             and not _CONTROL.search(lines[i] + lines[i + 1]) and not _DECL.match(lines[i])
             and lines[i][:len(lines[i]) - len(lines[i].lstrip())] == lines[i + 1][:len(lines[i + 1]) - len(lines[i + 1].lstrip())]]
    if not pairs:
        return None
    i = rng.choice(pairs)
    lines[i], lines[i + 1] = lines[i + 1], lines[i]
    return lines


def _shuffle_declarations(lines, rng):
    lo, hi = _body_bounds(lines)
    run = []
    for i in range(lo, hi):
        if _DECL.match(lines[i]) and "=" not in lines[i]:
            run.append(i)
        elif run:
            break
    if len(run) < 2:
        return None
    a, b = rng.sample(run, 2)
    lines[a], lines[b] = lines[b], lines[a]
    return lines


def _retype_local(lines, rng):
    lo, hi = _body_bounds(lines)
    cands = [i for i in range(lo, hi) if (m := _DECL.match(lines[i])) and m.group(3) in TYPES_32 and not m.group(4).strip()]
    if not cands:
        return None
    i = rng.choice(cands)
    m = _DECL.match(lines[i])
    lines[i] = f"{m.group(1)}{m.group(2) or ''}{rng.choice([t for t in TYPES_32 if t != m.group(3)])}{m.group(4)}{m.group(5)}{m.group(6)}"
    return lines


def _toggle_register(lines, rng):
    lo, hi = _body_bounds(lines)
    cands = [i for i in range(lo, hi) if _DECL.match(lines[i])]
    if not cands:
        return None
    i = rng.choice(cands)
    m = _DECL.match(lines[i])
    reg = "" if m.group(2) else "register "
    lines[i] = f"{m.group(1)}{reg}{m.group(3)}{m.group(4)}{m.group(5)}{m.group(6)}"
    return lines


_REWRITES = [
    (re.compile(r"\b(\w+)\+\+;"), lambda m: f"{m.group(1)} += 1;"),
    (re.compile(r"\b(\w+) \+= 1;"), lambda m: f"++{m.group(1)};"),
    (re.compile(r"\+\+(\w+);"), lambda m: f"{m.group(1)}++;"),
    (re.compile(r"\b(\w+)--;"), lambda m: f"{m.group(1)} -= 1;"),
    (re.compile(r"\b(\w+) -= 1;"), lambda m: f"{m.group(1)}--;"),
    (re.compile(r"\((\w+) < (\w+)\)"), lambda m: f"({m.group(2)} > {m.group(1)})"),
    (re.compile(r"\((\w+) > (\w+)\)"), lambda m: f"({m.group(2)} < {m.group(1)})"),
    (re.compile(r"\((\w+) <= (\w+)\)"), lambda m: f"({m.group(2)} >= {m.group(1)})"),
    (re.compile(r"\((\w+) >= (\w+)\)"), lambda m: f"({m.group(2)} <= {m.group(1)})"),
    (re.compile(r"\(!(\w+)\)"), lambda m: f"({m.group(1)} == 0)"),
    (re.compile(r"\((\w+) == 0\)"), lambda m: f"(!{m.group(1)})"),
    (re.compile(r"\((\w+) != 0\)"), lambda m: f"({m.group(1)})"),
    (re.compile(r"\(\s*(?:unsigned short|unsigned|short|int|s32|u32|uInt|uLong)\s*\)\s*(?=\w)"), lambda m: ""),
]


def _rewrite(lines, rng):
    lo, hi = _body_bounds(lines)
    options = [(i, rx, fn) for i in range(lo, hi) for rx, fn in _REWRITES if rx.search(lines[i])]
    if not options:
        return None
    i, rx, fn = rng.choice(options)
    matches = list(rx.finditer(lines[i]))
    m = rng.choice(matches)
    lines[i] = lines[i][:m.start()] + fn(m) + lines[i][m.end():]
    return lines


def _add_cast(lines, rng):
    lo, hi = _body_bounds(lines)
    cands = [(i, m) for i in range(lo, hi) if not _DECL.match(lines[i]) and "=" in lines[i]
             # rvalues only: never cast an assignment target, a call, or the base of a member/array access
             for m in re.finditer(r"(?<=[=(,+\-*/&|^ ])(\w+)\b(?!\s*(?:\(|=(?!=)|\+\+|--|\[|\.|->|[-+*/&|^]=))",
                                  lines[i]) if not m.group(1).isdigit()]
    if not cands:
        return None
    i, m = rng.choice(cands)
    lines[i] = lines[i][:m.start()] + rng.choice(CASTS) + lines[i][m.start():]
    return lines


MUTATIONS = [_swap_statements, _shuffle_declarations, _retype_local, _toggle_register, _rewrite, _rewrite, _add_cast]


def mutate(source: str, rng: random.Random) -> str | None:
    lines = source.split("\n")
    for _ in range(6):
        out = rng.choice(MUTATIONS)(list(lines), rng)
        if out is not None and out != lines:
            return "\n".join(out)
    return None


class LocalScorer:
    """Compile + score one job's sources on this machine, exactly like the coordinator does."""

    def __init__(self, job: dict, log=print):
        tc = toolchains.get(job["toolchain"])
        if toolchains.installed(tc.id) is None:
            if tc.proprietary:
                raise toolchains.ToolchainError(f"{tc.id} is proprietary; install it yourself if you accept its license")
            toolchains.install(tc.id, log=log)
        self._tmp = tempfile.TemporaryDirectory(prefix="decompnet-worker-")
        inc = Path(self._tmp.name)
        for rel, text in job.get("include_files", {}).items():
            dest = (inc / rel).resolve()
            if inc.resolve() not in dest.parents:
                raise ValueError(f"refusing include path {rel!r}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8", newline="\n")
        # the coordinator's own way to run the toolchain (on Windows, Linux-only ones go through WSL)
        compiler = {"toolchain": tc.id, "include_dirs": [str(inc)]}
        compiler.update({k: job[k] for k in ("cmd", "flags") if job.get(k)})
        self.cc = compiler_config(inc, {"compiler": compiler})
        t = job["target"]
        self.target = FunctionObj(job["function"], t["arch"], t["big_endian"], base64.b64decode(t["code"]),
                                  [Reloc.from_json(r) for r in t["relocs"]])
        self.context, self.name = job["context"], job["function"]

    def score(self, source: str) -> int | None:
        res = compile_source(self.cc, self.context, source)
        cand = extract_function(res.obj, self.name) if res.ok else None
        return scoring.diff(self.target, cand).score if cand else None


def search(job: dict, seconds: float, on_improvement, log=print, seed: int | None = None) -> tuple[int, str]:
    rng = random.Random(seed)
    scorer = LocalScorer(job, log)
    best_src = cur_src = job["source"]
    best = cur = scorer.score(best_src)
    if best is None:
        log("  the coordinator's best source doesn't compile here; skipping")
        return job["best_score"], best_src
    deadline, tries = time.monotonic() + seconds, 0
    while time.monotonic() < deadline and best > 0:
        cand = mutate(cur_src if rng.random() < 0.85 else best_src, rng)
        if cand is None:
            continue
        tries += 1
        s = scorer.score(cand)
        if s is None:
            continue
        if s < best:
            best, best_src = s, cand
            log(f"  try {tries}: score {s}")
            on_improvement(s, cand)
        if s <= cur or rng.random() < 0.02:  # mostly downhill, occasionally sideways to escape plateaus
            cur, cur_src = s, cand
    log(f"  {tries} variants tried, best {best}")
    return best, best_src


def _api(server: str, token: str, path: str, payload: dict | None = None) -> dict:
    req = urllib.request.Request(server.rstrip("/") + path, data=json.dumps(payload).encode() if payload else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "decompnet-worker"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def _log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)  # flush: the installer runs workers with output in a log file


def worker(server: str, token: str, minutes_per_job: float = 10, max_jobs: int = 0, log=_log) -> None:
    done = 0
    while not max_jobs or done < max_jobs:
        job = _api(server, token, "/api/jobs/next").get("job")
        if not job:
            log("no near-matches need work right now; checking again in 5 minutes")
            time.sleep(300)
            continue
        log(f"job: {job['project']}/{job['function']} (best score {job['best_score']}, {job['toolchain']})")
        submitted = {"best": job["best_score"]}

        def report(score: int, source: str, submitted=submitted, job=job) -> None:
            # `submitted`/`job` are bound as defaults: this loop's job, not the next one's
            if score < submitted["best"]:
                verdict = _api(server, token, "/api/jobs/submit",
                               {"project": job["project"], "function": job["function"], "source": source})
                log(f"  submitted score {score}: coordinator says {verdict}")
                if verdict.get("accepted"):
                    submitted["best"] = verdict.get("score", score)

        try:
            search(job, minutes_per_job * 60, report, log)
        except toolchains.ToolchainError as e:
            log(f"  skipped: {e}")
        done += 1
