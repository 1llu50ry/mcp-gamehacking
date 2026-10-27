"""Send matches upstream with credit: one git commit per matched function.

`decompnet upstream <project> <repo-dir>` writes each newly matched function into a git working tree and
commits it with the agent as author and its operator in the message. The tree carries the project's
license notice and marks every file as a reconstruction (required by licenses such as zlib's: altered
versions must be plainly marked). Push it and open a pull request upstream when you're ready.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from .network import Network

STATE = ".decompnet-upstream.json"


def _git(repo: Path, *args: str, env: dict | None = None) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                   env={**os.environ, **(env or {})})


def export(net: Network, project: str, repo: Path, log=print) -> int:
    proj = net._project(project)
    cfg = json.loads(proj["config"])
    legal = cfg.get("legal", {})
    toolchain = cfg.get("compiler", {}).get("toolchain", "the project's compiler")
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").exists():
        _git(repo, "init", "-q")
    state_file = repo / STATE
    done = set(json.loads(state_file.read_text(encoding="utf-8"))) if state_file.exists() else set()

    # license notice + provenance, refreshed every run
    for name in ("LICENSE.zlib", "LICENSE", "COPYING"):
        src = Path(proj["root"]) / name
        if src.exists():
            shutil.copy(src, repo / name)
    (repo / "README.md").write_text(
        f"# {proj['name']}: matched reconstructions\n\n"
        f"Functions reconstructed by AI agents on [decomp.wtf](https://decomp.wtf). Each one compiles with "
        f"`{toolchain}` to exactly the original machine code.\n\n"
        f"**These are reconstructions, not the original source files.** Lawful basis: {legal.get('basis')}. "
        f"License: {legal.get('license')}. {legal.get('notes', '')}\n\n"
        f"Headers the functions compile against are in `context/`.\n", encoding="utf-8")
    (repo / "context").mkdir(exist_ok=True)
    (repo / "context" / "context.h").write_text(net._context(proj["id"])["header"], encoding="utf-8")
    for unit in sorted(net._unit_contexts(proj["id"])):
        (repo / "context" / f"{unit}.h").write_text(net._context(proj["id"], unit)["header"], encoding="utf-8")

    rows = net.store.all(
        "SELECT f.name, f.unit, f.matched_source, f.matched_at, a.name AS agent, a.owner FROM functions f "
        "LEFT JOIN agents a ON a.id = f.matched_agent_id WHERE f.project_id = ? AND f.status = 'matched' "
        "ORDER BY f.matched_at", proj["id"])
    new = [r for r in rows if r["name"] not in done]
    committer = {"GIT_COMMITTER_NAME": "decomp.wtf", "GIT_COMMITTER_EMAIL": "noreply@decomp.wtf"}
    if not new:
        _git(repo, "add", "-A")
        subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "Update headers and notices"],
                       capture_output=True, env={**os.environ, **committer,
                                                 "GIT_AUTHOR_NAME": "decomp.wtf", "GIT_AUTHOR_EMAIL": "noreply@decomp.wtf"})
    for r in new:
        unit_dir = repo / "src" / (r["unit"] or "")
        unit_dir.mkdir(parents=True, exist_ok=True)
        path = unit_dir / f"{r['name']}.c"
        operator = f" (operator: {r['owner']})" if r["owner"] else ""
        path.write_text(
            f"/* {r['name']}: reconstructed by {r['agent']}{operator} on decomp.wtf.\n"
            f" * Verified byte-identical with {toolchain}. This is a reconstruction, not the original source.\n"
            f" * License: {legal.get('license')}. */\n\n{r['matched_source'].strip()}\n", encoding="utf-8")
        done.add(r["name"])
        state_file.write_text(json.dumps(sorted(done), indent=1), encoding="utf-8")
        _git(repo, "add", "-A")
        author = {"GIT_AUTHOR_NAME": r["agent"] or "unknown agent",
                  "GIT_AUTHOR_EMAIL": f"{r['agent'] or 'unknown'}@agents.decomp.wtf"}
        msg = (f"Match {r['name']}" + (f" ({r['unit']})" if r["unit"] else "") +
               f"\n\nVerified byte-identical with {toolchain} on decomp.wtf.\n\n"
               f"Matched-by: {r['agent']}{operator}")
        _git(repo, "commit", "-q", "-m", msg, env={**committer, **author})
    log(f"{len(new)} new match(es) committed to {repo}")
    return len(new)
