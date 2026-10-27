"""Project definitions (project.toml) and importing target functions into the network."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import scoring, seeds, toolchains, wsl
from .compiler import CompilerConfig, compile_source
from .elfobj import extract_function, list_functions
from .store import Store

# A project may only be imported with a declared lawful basis for sharing its code.
LEGAL_BASES = {
    "own-code": "written by the person or team importing it",
    "open-source": "released by its authors under an open license",
    "homebrew": "homebrew whose author allows decompilation and sharing",
    "permission": "imported with written permission from the rights holder",
}


class ProjectRejected(ValueError):
    pass


def check_legal(cfg: dict) -> dict:
    """Refuse projects without a lawful basis. This is policy, not paperwork: the network only
    hosts code that may legally be shared (no commercial games without the rights holder's OK)."""
    legal = cfg.get("legal") or {}
    basis = legal.get("basis")
    if basis not in LEGAL_BASES:
        raise ProjectRejected(
            "project.toml needs a [legal] section with basis = one of " + ", ".join(LEGAL_BASES)
            + ". Commercial games can only be imported with the rights holder's permission.")
    if basis != "own-code" and not str(legal.get("evidence", "")).strip():
        raise ProjectRejected(f"basis '{basis}' needs legal.evidence: a link to the license, "
                              "the author's statement, or a reference to the written permission")
    if not str(legal.get("license", "")).strip():
        raise ProjectRejected("legal.license must name the license contributions are shared under (e.g. CC0-1.0)")
    return legal


def load_config(root: Path) -> dict:
    with open(root / "project.toml", "rb") as f:
        return tomllib.load(f)


def compiler_config(root: Path, cfg: dict) -> CompilerConfig:
    """Build the sandboxed compile command for a project.

    Either `cmd` (a full command with {src} {obj} {include} placeholders) or `toolchain` (a registry id,
    see toolchains.toml) plus optional `flags`. With a toolchain, `{tc}` expands to its install directory,
    which is mounted read-only into the sandbox together with any runtime it requires."""
    c = cfg["compiler"]
    ro_paths = [str((root / p).resolve()) for p in c.get("ro_paths", [])]
    runtime32 = None
    linux = False
    if "toolchain" in c:
        tc = toolchains.get(c["toolchain"])
        linux = tc.via_wsl  # Windows: a Linux toolchain, run inside WSL 2
        tc_dir = ""
        if tc.system:  # already on the host (MinGW, cl under wine): nothing to download or mount
            flags = c.get("flags") or tc.flags
        else:
            if linux and not (ok := wsl.status())[0]:
                raise toolchains.ToolchainError(f"{tc.name} runs in WSL 2 on Windows. {ok[1]}")
            dirs = toolchains.runtime_dirs(tc.id)
            tc_dir = wsl.path(dirs[0]) if linux else str(dirs[0])
            ro_paths += [str(d) for d in dirs]
            if "runtime-i386" in tc.requires and not linux:  # in WSL its programs bring the runtime themselves
                runtime32 = str(toolchains.require("runtime-i386"))
            flags = c.get("flags") or tc.flags
        if c.get("cmd"):
            base = c["cmd"]
        elif tc.cmd:  # a full template ({flags} expands to the flags)
            base = [x for a in tc.cmd for x in (flags if a == "{flags}" else [a])]
        else:
            base = [*tc.cc, *flags, "-I{include}", "{src}", "-o", "{obj}"]
        cmd = [a.replace("{tc}", tc_dir) for a in base]
        for dep in ([] if tc.system else tc.requires):  # {tc:<id>} is another toolchain this one needs
            where = toolchains.path(dep, linux)
            cmd = [a.replace(f"{{tc:{dep}}}", wsl.path(where) if linux else str(where)) for a in cmd]
    else:
        cmd = list(c["cmd"])
    tc = toolchains.get(c["toolchain"]) if "toolchain" in c else None
    if tc and tc.system and cmd:
        # A host compiler may be an alternatives symlink outside the sandbox's /usr: run its real path.
        # Windows compilers installed off PATH (MSYS2, WinLibs, LLVM) are found in their usual folders.
        found = shutil.which(cmd[0]) if c.get("cmd") else None
        if not found and not c.get("cmd"):
            located = toolchains.system_binary(tc)
            found = str(located) if located else None
        if found:
            link = os.readlink(found) if os.path.islink(found) else ""
            # Resolve only an alternatives link (it points into /etc, which the sandbox doesn't mount).
            # Other symlinks inside /usr are fine mounted, and clang-cl depends on being invoked by that name.
            cmd[0] = str(Path(found).resolve()) if link.startswith("/etc/") else found
    return CompilerConfig(
        cmd=cmd,
        timeout=float(c.get("timeout", 15)),
        sandbox=c.get("sandbox", "auto"),
        image=c.get("image"),
        ro_paths=tuple(ro_paths),
        include_dirs=tuple(str((root / p).resolve()) for p in c.get("include_dirs", [])),
        runtime32=runtime32,
        wsl=linux,
    )


def target_objects(root: Path, cfg: dict) -> list[Path]:
    t = cfg["target"]
    if isinstance(t.get("build_from"), list):  # one object per source file, named after it
        return [root / "target" / f"{Path(src).stem}.o" for src in t["build_from"]]
    return [root / o for o in t["objects"]]


def build_target(root: Path, cfg: dict, log=print) -> None:
    """Build target objects from source the project is allowed to have (own code / open source),
    using the project's own sandboxed toolchain. Real ROM projects ship assembled targets instead."""
    t = cfg["target"]
    sources = t["build_from"] if isinstance(t["build_from"], list) else [t["build_from"]]
    outputs = target_objects(root, cfg)
    for src, out in zip(sources, outputs, strict=False):
        cc = compiler_config(root, cfg)
        src_path = root / src
        cc.include_dirs = (*cc.include_dirs, str(src_path.parent))
        log(f"building {out.relative_to(root)} from {src} with {cfg['compiler'].get('toolchain', 'cmd')}")
        out.parent.mkdir(parents=True, exist_ok=True)  # a fresh checkout has no target/ yet: gcc can't create it
        res = compile_source(cc, "", src_path.read_text(errors="replace", encoding="utf-8"), trusted=True)
        if not res.ok:
            raise ProjectRejected(f"target build failed for {src}:\n{res.log}")
        out.write_bytes(res.obj)


def import_project(store: Store, root: Path, log=print) -> int:
    """Create or refresh a project. Existing progress (matches, attempts) is kept;
    new functions are added; targets of unmatched functions are refreshed."""
    root = root.resolve()
    cfg = load_config(root)
    check_legal(cfg)
    slug = cfg["slug"]
    target = cfg["target"]

    objects = target_objects(root, cfg)
    hash_only = target.get("verification", "full") == "hash"
    for obj in objects:
        obj.parent.mkdir(parents=True, exist_ok=True)  # a fresh checkout has no target/ dir yet
    if "build_from" in target and not all(o.exists() for o in objects):
        build_target(root, cfg, log)
    elif "build" in target and not all(o.exists() for o in objects):
        log(f"building target objects: {' '.join(target['build'])}")
        subprocess.run(target["build"], cwd=root, check=True)

    funcs = []
    seen: dict[str, str] = {}
    arch, big_endian = None, False
    for obj in objects:
        data = obj.read_bytes()
        for name in list_functions(data):
            if name in cfg.get("exclude", []):
                continue
            if name in seen:
                raise ProjectRejected(f"function {name!r} exists in both {seen[name]} and {obj.name}; "
                                      f"add one of them to `exclude` in project.toml")
            seen[name] = obj.name
            unit = obj.stem
            fn = extract_function(data, name)
            arch, big_endian = fn.arch, fn.big_endian
            insns = scoring.disassemble(fn)
            seed_file = root / "seeds" / f"{name}.c"
            funcs.append([name, fn, len(insns), scoring.asm_text(fn),
                          seed_file.read_text(encoding="utf-8") if seed_file.exists() else None, unit])

    header = (root / cfg["context"]["file"]).read_text(encoding="utf-8")
    # Optional per-unit headers: [context] units = "units/{unit}.h" (one per source file / object)
    unit_headers = {}
    if cfg["context"].get("units"):
        for obj in objects:
            path = root / cfg["context"]["units"].format(unit=obj.stem)
            if path.exists():
                unit_headers[obj.stem] = path.read_text(encoding="utf-8")
    def header_of(f):
        return unit_headers.get(f[5], header)
    # Functions without a hand-written seed get a machine-generated starting point (m2c), when available.
    tc_id = cfg["compiler"].get("toolchain")
    missing = [f for f in funcs if f[4] is None]
    if missing and not hash_only and tc_id in seeds.M2C_TARGETS and seeds.available():
        with ThreadPoolExecutor(max_workers=4) as pool:
            drafts = list(pool.map(lambda f: seeds.generate(f[1], tc_id, header_of(f)), missing))
        for f, draft in zip(missing, drafts, strict=False):
            f[4] = f"/* machine-generated by m2c: a starting point, not a match */\n{draft}" if draft else None
        log(f"m2c drafted {sum(d is not None for d in drafts)}/{len(missing)} functions")
    now = time.time()
    with store.tx() as db:
        row = db.execute("SELECT id FROM projects WHERE slug=?", (slug,)).fetchone()
        if row is None:
            pid = db.execute(
                "INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                (slug, cfg.get("name", slug), cfg.get("description", ""), arch, big_endian, str(root), json.dumps(cfg)),
            ).lastrowid
            db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                       "VALUES(?,?,?,?,?,?,?)", (pid, 1, header, None, "initial import", now, ""))
        else:
            pid = row["id"]
            db.execute(
                "UPDATE projects SET name=?,description=?,arch=?,big_endian=?,root=?,config=? WHERE id=?",
                (cfg.get("name", slug), cfg.get("description", ""), arch, big_endian, str(root), json.dumps(cfg), pid),
            )
        have = {r["unit"] for r in db.execute("SELECT DISTINCT unit FROM context_versions WHERE project_id=?", (pid,))}
        for unit, text in unit_headers.items():
            if unit not in have:
                version = db.execute("SELECT MAX(version) AS v FROM context_versions WHERE project_id=?", (pid,)).fetchone()["v"] + 1
                db.execute("INSERT INTO context_versions(project_id,version,header,agent_id,message,created_at,unit) "
                           "VALUES(?,?,?,?,?,?,?)", (pid, version, text, None, f"initial import ({unit})", now, unit))
        for name, fn, n_insns, asm, seed, unit in funcs:
            if hash_only:  # keep only a one-way fingerprint and the size, never the code or its disassembly
                target_bytes, relocs, asm, seed = None, "[]", "", None
            else:
                target_bytes, relocs = fn.code, json.dumps([r.to_json() for r in fn.relocs])
            db.execute(
                """INSERT INTO functions(project_id,name,size,n_insns,target,relocs,asm,seed,fingerprint,unit)
                   VALUES(?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(project_id,name) DO UPDATE SET size=excluded.size, n_insns=excluded.n_insns,
                   target=excluded.target, relocs=excluded.relocs, asm=excluded.asm, seed=excluded.seed,
                   fingerprint=excluded.fingerprint, unit=excluded.unit
                   WHERE functions.status != 'matched'""",
                (pid, name, len(fn.code), n_insns, target_bytes, relocs, asm, seed, fn.fingerprint(), unit),
            )
    log(f"project {slug!r}: {len(funcs)} functions ({arch})")
    return pid
