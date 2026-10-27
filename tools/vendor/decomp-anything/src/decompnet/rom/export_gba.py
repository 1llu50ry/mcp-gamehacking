"""Export a Game Boy Advance project as a rebuildable source tree: the base for ports and mods.

Like export.py for MIPS games: luvdis's assembly (with the project's names) for everything not decompiled yet, the
matched functions as C built with agbcc, and a linker script that puts every piece at its address in the ROM. The
build links it with the Arm GNU toolchain and checks the result against your copy, byte for byte. The assembly is
made from the game, so it stays out of git: build.py regenerates it from your copy with luvdis.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from ..limits import capped
from . import match_arm
from .gba import BASE
from .symbols import AUTO_NAME


def export_gba(net, slug: str, out: Path, log=print) -> dict:
    proj = net._project(slug)
    cfg = net.cfg(proj)
    work = Path(proj["root"])
    image = (work / cfg["rom"]["file"]).read_bytes()
    if out.exists():
        for child in out.iterdir():
            if child.name != ".git":
                shutil.rmtree(child) if child.is_dir() else child.unlink()
    out.mkdir(parents=True, exist_ok=True)

    rows = net.store.all("SELECT * FROM functions WHERE project_id=? ORDER BY vram", proj["id"])
    syms = net.symbols(proj["id"])
    units = net._unit_contexts(proj["id"])
    (out / "include").mkdir(exist_ok=True)
    (out / "include" / "common.h").write_text(net._context(proj["id"])["header"], encoding="utf-8")

    log("checking the matched functions and writing them as C")
    functions, fallback = [], []
    for row in rows:
        thumb = "arm_func_start" not in (row["asm"] or "")
        f = {"name": row["name"], "addr": row["vram"], "size": len(row["target"]), "thumb": thumb}
        functions.append(f)
        if row["status"] != "matched" or not row["matched_source"]:
            continue
        why = _check_c(net, proj, row, thumb, units, f)
        if why:
            fallback.append((row["name"], why))
            continue
        src = out / "src" / f"{row['name']}.c"
        src.parent.mkdir(exist_ok=True)
        src.write_text(f'#include "common.h"\n\n{row["matched_source"].strip()}\n', encoding="utf-8")
        f["c"] = src.relative_to(out).as_posix()

    names = {f["name"] for f in functions}
    symbols = {s.name: s.address for s in syms.by_name.values() if s.name not in names and not AUTO_NAME.match(s.name)}
    # luvdis writes the project's names: every function by name, ARM or Thumb
    (out / "functions.cfg").write_text("# [arm_func|thumb_func] <address> <name>: read by luvdis in build.py\n" + "".join(
        f"{'thumb_func' if f['thumb'] else 'arm_func'} 0x{f['addr']:X} {f['name']}\n" for f in functions), encoding="utf-8")
    build = {
        "title": proj["name"], "platform": "gba", "image": "baserom.gba", "output": "build/game.gba",
        "sha1": hashlib.sha1(image).hexdigest(), "base": BASE, "compiler": cfg["compiler"],
        "functions": functions, "symbols": dict(sorted(symbols.items(), key=lambda kv: kv[1])),
    }
    (out / "build.json").write_text(json.dumps(build, indent=1), encoding="utf-8")
    shutil.copyfile(Path(__file__).with_name("export_gba_build.py"), out / "build.py")
    shutil.copyfile(work / cfg["rom"]["file"], out / "baserom.gba")
    matched = sum(1 for f in functions if f.get("c"))
    _docs(out, proj["name"], matched, len(functions), fallback)
    (out / ".gitignore").write_text("build/\nbaserom*\nasm/\n", encoding="utf-8")

    log("building the exported project to check it rebuilds the game byte for byte")
    proc = subprocess.run(capped([sys.executable, "build.py"]), cwd=out, capture_output=True, text=True, timeout=3600,
                          encoding="utf-8", errors="replace")
    identical = proc.returncode == 0 and "identical" in proc.stdout
    if not identical:
        log((proc.stdout + proc.stderr)[-3000:])
    return {"path": str(out), "identical": identical, "matched": matched, "functions": len(functions),
            "fallback": fallback, "log": (proc.stdout + proc.stderr)[-3000:]}


def _check_c(net, proj, row, thumb: bool, units, f: dict) -> str | None:
    """Why a matched function can't be C in the tree (None: it can), recording where its own data goes."""
    if row["vram"] % 4:
        return "it starts halfway a word, where agbcc never puts a function"
    hdr = net._context(proj["id"], net._effective_unit(row, units))["header"]
    compiled = net._compile(proj, hdr, row["matched_source"])
    if not compiled.ok:
        return "doesn't compile any more"
    linked = match_arm.link(compiled.obj, row["name"], match_arm.ArmTarget(row["name"], row["vram"], row["target"], thumb),
                            net.symbols(proj["id"]), net.reader(proj))
    if not linked.exact:
        return "no longer matches"
    own = {}
    for section, offsets in linked.placements.items():
        base = {addr - off for off, addr in offsets.items()}
        if len(base) != 1:
            return "its own data isn't laid out like the game's"
        own[section] = base.pop()
    f["own"] = own
    return None


def _docs(out: Path, title: str, matched: int, total: int, fallback) -> None:
    notes = "".join(f"\n- `{n}`: kept as assembly, {why}" for n, why in fallback)
    (out / "README.md").write_text(f"""# {title} (decompilation)

A matching decompilation of {title} for the Game Boy Advance, started with [decomp.wtf](https://decomp.wtf).
{matched} of {total} functions are C that agbcc compiles to exactly the original code; the rest is still assembly.
`build.py` rebuilds the ROM from this tree and checks it against your original, byte for byte.

## Build

1. Put your own copy of the game here as `baserom.gba` (it is in `.gitignore`; never commit it).
2. `python build.py` (needs decomp.wtf installed, for agbcc, luvdis and the Arm GNU toolchain).

The first build disassembles your copy with [luvdis](https://github.com/aarant/luvdis) into `asm/`, one file per
function, using the names in `functions.cfg`.

## Layout

| Path | What it is |
| :-- | :-- |
| `src/<function>.c` | Decompiled functions, one per file, each matching the original. |
| `asm/` | Assembly of everything else, made from your copy by the first build. |
| `include/common.h` | Types, structs and prototypes worked out so far. |
| `functions.cfg` | Every function's address and name (rename here, then delete `asm/` to regenerate). |
| `build.json`, `build.py` | What's where, and the build. `build/game.ld` puts every piece at its address. |

Keep going with any tool: write a function as `src/<name>.c`, run `python build.py check <name>`, then
`python build.py`. When it says *identical*, the ROM still matches. This is the base for ports and mods: once
everything is C, the game can be rebuilt, changed and moved to other platforms.

The game's code and data belong to their rights holder: keep this tree to yourself unless you have the right to
share it.{chr(10) + chr(10) + '## Notes' + notes if notes else ''}
""", encoding="utf-8")
    (out / "AGENTS.md").write_text("""# Working on this decompilation

- Goal: C that agbcc turns into exactly the original bytes. `python build.py` must end with "identical".
- Pick a function from `asm/`, write it as `src/<name>.c` (one function, `#include "common.h"` first), then
  `python build.py check <name>`: it compiles it, compares it with the original and records it in `build.json`.
- Shared types and prototypes go in `include/common.h`. Never edit `baserom.gba` or `asm/` to force a match.
""", encoding="utf-8")
