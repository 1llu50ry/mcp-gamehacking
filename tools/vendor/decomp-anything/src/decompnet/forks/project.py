"""A decomp project on disk: what kind it is, what it needs, how to set it up, build a unit and diff it.

Layouts set up automatically:
- manifest:  the project ships `.decomp.wtf.json`: {"game": {"what", "path", "sha1"}, "setup": [[cmd...], ...]}.
- dtk:       GameCube/Wii (and similar) projects from dtk-template: configure.py + config/<version>/config.yml,
             built with ninja; the disc image goes in orig/<version>/.
- configure: other configure.py + ninja projects (many PS2 and DS decomps).
- splat:     N64/PlayStation-style projects (splat yaml + Makefile); the game file goes where the yaml's
             target_path says and is checked against its sha1.
Everything else (CMake, justfiles, custom scripts) is set up by the user following its README; once the build
has produced objdiff.json, decomp.wtf takes over. Nearly every project on decomp.dev ends up with one, since
that's how its progress is reported.
"""

from __future__ import annotations

import collections
import functools
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from ..limits import capped, killed_for_memory
from ..network import NetworkError
from . import objdiff

STATE = ".decomp-wtf"
_CONFIG_CACHE: dict[str, tuple] = {}  # objdiff.json path -> (stat key, parsed, units by name)
_CONFIG_LOCK = threading.Lock()
# Agents may only edit source and header files, never the project's build setup, targets or verification.
EDITABLE = re.compile(r"\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc|inl)$", re.IGNORECASE)
FORBIDDEN_PARTS = {".git", STATE, "orig", "build", "asm", "expected", "tools", "config", ".github", "assets", "bin"}


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class ForkError(NetworkError):
    """Shown to the user or agent as is."""


@dataclass
class Unit:
    name: str
    target: Path | None
    base: Path | None
    source: str | None  # path relative to the project root
    complete: bool
    scratch: dict | None
    options: dict | None = None  # the unit's own objdiff options
    mappings: dict | None = None  # objdiff symbol mappings (target name -> base name)
    auto: bool = False  # split off by dtk because no file covers it (auto_00_80003100_text)


@functools.lru_cache(maxsize=64)
def _git_env(root: Path) -> dict | None:
    """Commits need an identity: when git has none set up on this computer, commits are by decomp.wtf."""
    res = subprocess.run(["git", "config", "user.email"], cwd=root, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if res.returncode == 0 and res.stdout.strip():
        return None
    who = {"GIT_AUTHOR_NAME": "decomp.wtf", "GIT_AUTHOR_EMAIL": "noreply@decomp.wtf"}
    return {**os.environ, **who, "GIT_COMMITTER_NAME": who["GIT_AUTHOR_NAME"], "GIT_COMMITTER_EMAIL": who["GIT_AUTHOR_EMAIL"]}


# dtk-template's configure.py: Object(NonMatching, "path.c"), also over several lines, MatchingFor("GALE01")...
_OBJECT = re.compile(r'\bObject\(\s*(NonMatching|Matching|Equivalent|MatchingFor\([^()]*\))\s*,\s*"([^"]+)"', re.DOTALL)
_SRC_DIR = re.compile(r'^\s*config\.src_dir\s*=\s*Path\(\s*"([^"]+)"\s*\)', re.MULTILINE)
_CHECK = re.compile(r"^build (\S+[/\\]ok): check\b")  # dtk-template writes build\<version>\ok on Windows
# A target the build couldn't make: ninja's "FAILED: out.o", make's "make: *** [Makefile:12: out.o] Error 1"
_FAILED = re.compile(r"^FAILED: (.+)$|^make(?:\[\d+\])?: \*\*\* \[(?:[^\]]*?:\d+: )?([^\]]+)\] Error")
# CodeWarrior's linker warns about every FORCEACTIVE symbol and unknown section: harmless, and thousands of lines
_NOISE = re.compile(r"^#{1,3}\s*(mwldeppc\.exe Linker Warning:|FORCEACTIVE symbol|(doesn't )?exist\.\s+Ignored\.|"
                    r"Section '\.note\.split' is unknown)")


def _tool(name: str) -> str | None:
    """A build tool from PATH or from decomp.wtf's own environment (the ninja Python package)."""
    found = shutil.which(name)
    if found:
        return found
    local = Path(sys.executable).parent / (f"{name}.exe" if os.name == "nt" else name)
    return str(local) if local.exists() else None


class ForkProject:
    def __init__(self, root: Path):
        self.root = Path(root)
        (self.root / STATE).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ what is it

    @property
    def manifest(self) -> dict | None:
        p = self.root / ".decomp.wtf.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def kind(self) -> str:
        if self.manifest:
            return "manifest"
        if (self.root / "configure.py").exists() and list(self.root.glob("config/*/config.yml")):
            return "dtk"
        if (self.root / "configure.py").exists():
            return "configure"
        if self._splat_yaml() and (self.root / "Makefile").exists():
            return "splat"
        if (self.root / "objdiff.json").exists():
            return "objdiff"
        return "custom"

    def readme(self, limit: int = 70) -> str:
        """The README's build/setup section (plain text, from the repository: untrusted, display only)."""
        for name in ("README.md", "README.MD", "readme.md", "README.rst", "README.txt", "README"):
            p = self.root / name
            if p.exists():
                lines = p.read_text(errors="replace", encoding="utf-8").splitlines()
                break
        else:
            return ""
        def heading(i: int) -> bool:  # markdown "# Title" or an underlined (setext/rst) title, not a badge row
            if "![" in lines[i] or "[!" in lines[i]:
                return False
            if lines[i].lstrip().startswith("#"):
                return True
            return bool(lines[i].strip()) and i + 1 < len(lines) and bool(re.fullmatch(r"\s*[=-]{3,}\s*", lines[i + 1]))

        wanted = re.compile(r"build|setup|set up|getting started|usage|install|requirements|prerequisite", re.IGNORECASE)
        start = next((i for i in range(len(lines)) if heading(i) and wanted.search(lines[i])), 0)
        return "\n".join(lines[start:start + limit]).strip()

    def versions(self) -> list[str]:
        return sorted(p.parent.name for p in self.root.glob("config/*/config.yml"))

    def _splat_yaml(self) -> Path | None:
        for p in sorted(self.root.glob("*.yaml")) + sorted(self.root.glob("config/*.yaml")) + sorted(self.root.glob("config/**/*.yaml")):
            try:
                text = p.read_text(errors="replace", encoding="utf-8")
            except OSError:
                continue
            if "segments:" in text and "options:" in text:
                return p
        return None

    def _inside(self, rel: str) -> str | None:
        """`rel` as a clean path inside the project, or None if it points outside or is a template."""
        if not rel or "__" in rel or "$" in rel or "{" in rel:
            return None
        p = (self.root / rel).resolve()
        if self.root.resolve() not in p.parents:
            return None
        out = Path(os.path.relpath(p, self.root.resolve())).as_posix()
        return out + "/" if rel.endswith("/") else out

    def needs(self, version: str | None = None) -> dict:
        """What the user has to provide: {"what", "path" (None: set up by hand), "sha1", "help", "auto"}."""
        kind = self.kind()
        manual = {"what": "your copy of the game", "path": None, "sha1": None, "auto": False,
                  "help": "This project has its own setup. Follow its README in a terminal, in the project folder; "
                          "once its build has produced objdiff.json, click Check again."}
        if kind == "manifest":
            g = self.manifest.get("game", {})
            path = self._inside(g.get("path", ""))
            return {"what": g.get("what", "your copy of the game"), "path": path, "sha1": g.get("sha1"),
                    "help": g.get("help", ""), "auto": path is not None}
        if kind == "dtk":
            v = version or (self.versions()[0] if self.versions() else "")
            return {"what": "your copy of the game's disc (ISO, GCM, RVZ, WIA, WBFS, CISO, NFS or GCZ)",
                    "path": f"orig/{v}/", "sha1": None, "auto": True,
                    "help": f"Version {v}. The build checks the disc's main executable against the project's hash."}
        if kind == "configure":
            v = version or ""
            if v and (self.root / "orig" / v).is_dir():
                return {"what": "your copy of the game (see the README for the exact file)", "path": f"orig/{v}/",
                        "sha1": None, "auto": True, "help": "The build checks the game against the project's hashes."}
            return manual
        if kind == "splat":
            y = self._splat_yaml().read_text(errors="replace", encoding="utf-8")
            target = re.search(r"^\s*target_path:\s*['\"]?([^'\"\n#]+)", y, re.MULTILINE)
            base = re.search(r"^\s*base_path:\s*['\"]?([^'\"\n#]+)", y, re.MULTILINE)
            sha1 = re.search(r"^sha1:\s*['\"]?([0-9a-fA-F]{40})", y, re.MULTILINE)
            path = target.group(1).strip() if target else ""
            yaml_dir = os.path.relpath(self._splat_yaml().parent, self.root)
            if path and base:
                path = str(Path(yaml_dir) / base.group(1).strip() / path)
            path = self._inside(path) if path else None
            if path is None:
                return manual
            return {"what": f"your copy of the game ({Path(path).name})", "path": path,
                    "sha1": sha1.group(1).lower() if sha1 else None, "auto": True,
                    "help": "Checked against the sha1 in the project's splat config. A PlayStation disc image works "
                            "too: the file is taken from it."}
        return manual

    # ------------------------------------------------------------------ setup

    def place_game(self, src: Path, filename: str, version: str | None = None, move: bool = False) -> Path:
        """Put the user's game file where the project expects it, checking its sha1 when the project has one.
        Works from a file on disk, so multi-gigabyte discs are never read into memory."""
        need = self.needs(version)
        if not need["path"]:
            raise ForkError("decomp.wtf doesn't know where this project expects the game; follow its README")
        src = Path(src)
        if need.get("sha1") and _sha1(src) != need["sha1"]:
            inner = self._from_disc(src.read_bytes(), Path(need["path"]).name) if src.stat().st_size < 1 << 30 else None
            if inner is None or hashlib.sha1(inner).hexdigest() != need["sha1"]:
                raise ForkError("that file isn't the version this project decompiles (its sha1 doesn't match the "
                                "project's); check the README for the exact version")
            dest = self.root / need["path"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(inner)
            return dest
        dest = self.root / need["path"]
        if need["path"].endswith("/"):
            dest.mkdir(parents=True, exist_ok=True)
            dest = dest / (Path(filename).name or "game.iso")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
        if move:
            shutil.move(str(src), dest)
        else:
            try:
                os.link(src, dest)  # no second copy of a big disc when it's on the same drive
            except OSError:
                shutil.copyfile(src, dest)
        return dest

    @staticmethod
    def _from_disc(data: bytes, name: str) -> bytes | None:
        """A file (e.g. SLUS_013.95) taken from a PlayStation disc image."""
        from ..rom import psx

        if not psx.is_disc(data):
            return None
        try:
            return psx._Disc(data).find(name)
        except (ValueError, IndexError, KeyError):
            return None

    def setup_commands(self, version: str | None = None) -> list[list[str]]:
        kind = self.kind()
        if kind == "manifest":
            m = self.manifest
            cmds = m.get("setup", [])
            if m.get("created") == "from scratch" and cmds:  # point at this computer's tools, not the creator's
                from . import scratch_dsd, scratch_dtk

                args = (scratch_dsd if m.get("platform") == "nds" else scratch_dtk).tool_args()
                first = cmds[0]
                keep = next((i for i, c in enumerate(first) if c.startswith("--")), len(first))
                cmds = [[*first[:keep], *args], *cmds[1:]]
            return [[sys.executable if c == "python" else c for c in cmd] for cmd in cmds]
        if kind == "dtk":
            cmd = [sys.executable, "configure.py"]
            if version and len(self.versions()) > 1:
                cmd += ["--version", version]
            return [cmd, [_tool("ninja") or "ninja"]]
        if kind == "configure":
            return [[sys.executable, "configure.py"], [_tool("ninja") or "ninja"]]
        if kind == "splat":
            make = (self.root / "Makefile").read_text(errors="replace", encoding="utf-8")
            steps = [["make", t] for t in ("setup", "extract") if re.search(rf"^{t}\s*:", make, re.MULTILINE)][:1]
            return [*steps, ["make", f"-j{os.cpu_count() or 4}"]]
        if kind == "objdiff":
            cfg = self.objdiff_config()
            return [[cfg.get("custom_make") or "make", *cfg.get("custom_args", [])]]
        raise ForkError("decomp.wtf can't tell how to build this project; follow its README, then refresh")

    def run(self, cmd: list[str], log=print, timeout: float = 3600, failed: list[str] | None = None) -> tuple[bool, str]:
        """Run a build step in the project. Targets the build reports as failed (ninja's FAILED:, make's Error lines)
        are added to `failed`."""
        env = dict(os.environ)
        env["PATH"] = os.pathsep.join([str(Path(sys.executable).parent), env.get("PATH", "")])
        # found on that PATH (decomp.wtf's own ninja): Linux looks a command up there itself, Windows only in this
        # process's PATH, where decomp.wtf's environment isn't when it's installed
        cmd = [shutil.which(cmd[0], path=env["PATH"]) or cmd[0], *cmd[1:]]
        log("$ " + " ".join(Path(c).name if i == 0 else c for i, c in enumerate(cmd)))
        try:
            proc = subprocess.Popen(capped(cmd), cwd=self.root, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, errors="replace", encoding="utf-8")
        except FileNotFoundError:
            return False, f"{cmd[0]} isn't installed"
        out, seen, quiet = [], collections.Counter(), 0
        try:
            for line in proc.stdout:
                line = line.rstrip()
                out.append(line)
                if failed is not None and (m := _FAILED.match(line)):
                    failed.extend(t for t in (m.group(1) or m.group(2)).split()
                                  if t not in failed and not t.startswith("[code="))
                seen[line] += 1
                if seen[line] > 2 or _NOISE.match(line):  # the same line again, or CodeWarrior's linker chatter
                    quiet += 1
                elif len(out) <= 400 or len(out) % 50 == 0:
                    log(line)
            try:
                code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()  # reap it: the build is over, its exit code is not needed
                return False, "timed out"
        finally:
            if proc.stdout is not None:
                proc.stdout.close()  # the pipe's file object, not left for the garbage collector
        if quiet:
            log(f"({quiet} repeated lines and linker warnings not shown)")
        if killed_for_memory(code):
            out.append("stopped: it used more memory than decomp.wtf allows a single tool, so it was stopped "
                       "before it could slow down or freeze your computer")
        return code == 0, "\n".join(out[-60:])

    def unpack_disc(self, version: str | None, log=print) -> int:
        """A dtk project that reads an extracted disc (orig/<version>/sys/main.dol, files/...) instead of the disc
        image: copy the files its config names out of the user's disc image with decomp.wtf's own dtk, as the README's
        "extract the disc with Dolphin" step would. Returns how many files were copied."""
        if self.kind() != "dtk" or not version:
            return 0
        cfg, orig = self.root / "config" / version / "config.yml", self.root / "orig" / version
        if not cfg.is_file() or not orig.is_dir():
            return 0
        text = cfg.read_text(errors="replace", encoding="utf-8")
        if re.search(r"^\s*object_base\s*:", text, re.MULTILINE):
            return 0  # this dtk reads the disc image itself
        wanted = sorted({m.group(1) for m in re.finditer(rf"orig/{re.escape(version)}/([^\s'\"#,\]]+)", text)})
        missing = [w for w in wanted if not w.endswith("/") and ".." not in w and not (orig / w).exists()]
        if not missing:
            return 0
        from . import scratch_dtk

        discs = [(p, scratch_dtk.disc_id(p)) for p in sorted(orig.iterdir()) if p.is_file() and p.stat().st_size > 1 << 20]
        discs = [(p, gid) for p, gid in discs if gid]
        disc = next((p for p, gid in discs if gid == version), None) or (discs[0][0] if len(discs) == 1 else None)
        if disc is None:
            return 0  # no disc image here (or only other versions): the project's own error says what's missing
        log(f"taking the {len(missing)} files the project reads out of your disc image ({disc.name})")
        by_dir: dict[str, list[str]] = {}
        for w in missing:
            by_dir.setdefault(str(Path(w).parent), []).append(w)
        for parent, files in by_dir.items():
            scratch_dtk.vfs_copy(disc, files, orig / parent)
        return len(missing)

    def setup(self, version: str | None = None, log=print) -> None:
        self.unpack_disc(version, log=log)
        for cmd in self.setup_commands(version):
            ok, tail = self.run(cmd, log=log)
            if not ok and cmd[0] != "make":  # a Makefile build often fails on purpose until things match
                raise ForkError(f"setup step failed: {' '.join(cmd)}\n{tail}")
        if (self.root / "objdiff.json").exists() and self._all_source():
            log("compiling every source file, so objdiff can measure each one (some work in progress may not compile)")
            self.build_all(log=log)
        if not (self.root / "objdiff.json").exists():
            raise ForkError("the project built, but has no objdiff.json, so decomp.wtf can't measure matches. "
                            "Some projects generate it with an extra step; check the README.")

    # ------------------------------------------------------------------ objdiff project

    def _config_entry(self) -> tuple[tuple, dict, dict]:
        """(stat key, objdiff.json, units by name), parsed once per change of the file: a big game's runs to
        megabytes and every compile needs it."""
        p = self.root / "objdiff.json"
        try:
            st = p.stat()
        except OSError:
            raise ForkError("objdiff.json not found: set the project up first") from None
        key = (st.st_mtime_ns, st.st_size)
        with _CONFIG_LOCK:
            hit = _CONFIG_CACHE.get(str(p))
            if hit is None or hit[0] != key:
                for wait in range(40):  # configure.py rewrites it when a file is linked: read it whole
                    try:
                        cfg = json.loads(p.read_text(encoding="utf-8"))
                        break
                    except (ValueError, OSError):
                        if wait == 39:
                            if hit is not None:
                                return hit  # the last whole one: units rarely change between two writes
                            raise ForkError("objdiff.json can't be read (it's being rewritten): try again") from None
                        time.sleep(0.15)
                st = p.stat()
                key = (st.st_mtime_ns, st.st_size)
                by_name: dict[str, Unit] = {}
                for u in self._units_of(cfg):
                    by_name.setdefault(u.name, u)
                hit = _CONFIG_CACHE[str(p)] = (key, cfg, by_name)
            return hit

    def objdiff_config(self) -> dict:
        return self._config_entry()[1]

    def _units_of(self, cfg: dict) -> list[Unit]:
        tdir, bdir = cfg.get("target_dir"), cfg.get("base_dir")
        out = []
        for u in cfg.get("units") or cfg.get("objects") or []:
            meta = u.get("metadata") or {}
            t = u.get("target_path") or (str(Path(tdir) / u["path"]) if tdir and u.get("path") else None)
            b = u.get("base_path") or (str(Path(bdir) / u["path"]) if bdir and u.get("path") else None)
            out.append(Unit(u.get("name") or u.get("path") or "?", self.root / t if t else None,
                            self.root / b if b else None, meta.get("source_path"),
                            bool(meta.get("complete", u.get("complete", False))), u.get("scratch"),
                            u.get("options") or None, u.get("symbol_mappings") or None, bool(meta.get("auto_generated"))))
        return out

    def units(self) -> list[Unit]:
        return self._units_of(self.objdiff_config())

    def unit(self, name: str) -> Unit:
        found = self._config_entry()[2].get(name)
        if found is None:
            raise ForkError(f"no unit {name!r}")
        return found

    def units_for(self, rel: str) -> list[Unit]:
        """The units whose source file is `rel` (relative to the project root)."""
        want = Path(rel).as_posix()
        return [u for u in self.units() if u.source and Path(u.source).as_posix() == want]

    def diff_options(self, unit: Unit) -> dict:
        """What every diff of this unit is judged by: the progress report's rules with the project's and unit's options."""
        return objdiff.judge_options(self.objdiff_config().get("options"), unit.options)

    def build_unit(self, unit: Unit, log=lambda *_: None) -> tuple[bool, str]:
        if unit.base is None:
            return False, "this unit has no source object to build"
        cfg = self.objdiff_config()
        make = cfg.get("custom_make") or "make"
        tool = _tool(make) or make
        rel = os.path.relpath(unit.base, self.root)
        return self.run([tool, *cfg.get("custom_args", []), rel], log=log, timeout=600)

    def failed_units(self, targets: list[str]) -> set[str]:
        """Units whose source object is among the build's failed targets."""
        want = {os.path.normpath(t) for t in targets}
        return {u.name for u in self.units() if u.base is not None and os.path.normpath(os.path.relpath(u.base, self.root)) in want}

    def _all_source(self) -> bool:
        """dtk-template's `all_source`: every unit's source object, including units the game's link doesn't use yet
        (the default build only compiles what the link needs, so objdiff would have nothing to measure them by)."""
        try:
            with open(self.root / "build.ninja", errors="replace", encoding="utf-8") as f:
                return any(line.startswith("build all_source:") for line in f)
        except OSError:
            return False

    def build_all(self, log=lambda *_: None, failed: list[str] | None = None) -> tuple[bool, str]:
        cfg = self.objdiff_config()
        make = cfg.get("custom_make") or "make"
        if (make == "ninja" or Path(make).name.startswith("ninja")) and self._all_source():
            # -k 0: keep going past work in progress that doesn't compile yet
            return self.run([_tool(make) or make, *cfg.get("custom_args", []), "-k", "0", "all_source"], log=log,
                            failed=failed)
        keep_going = ["-k"] if Path(make).name in ("make", "gmake", "mingw32-make") else []
        return self.run([_tool(make) or make, *cfg.get("custom_args", []), *keep_going], log=log, failed=failed)

    def report(self) -> dict:
        return objdiff.report(self.root, self.root / STATE / "report.json")

    def diff(self, unit: Unit, symbol: str) -> objdiff.FunctionDiff:
        return objdiff.diff(unit.target, unit.base, symbol, cwd=self.root, options=self.diff_options(unit),
                            project=self.root if unit.mappings else None, unit=unit.name)

    # ------------------------------------------------------------------ linking (dtk-template projects)
    # A file whose code and data match is linked into the game: configure.py marks it Matching, the build then
    # uses its compiled object instead of the original's, and the project's checksum check (`ninja .../ok`) proves
    # the whole game still comes out byte for byte. That's what decomp.dev counts as linked.

    def check_target(self) -> str | None:
        """dtk-template's checksum target (build/<version>/ok: the built DOL and RELs against the game's SHA-1s)."""
        try:
            with open(self.root / "build.ninja", errors="replace", encoding="utf-8") as f:
                for line in f:
                    m = _CHECK.match(line)
                    if m:
                        return m.group(1)
        except OSError:
            pass
        return None

    def link_states(self) -> dict[str, tuple[str, int, int]]:
        """Source file (relative to the project root) -> (its link state in configure.py: Matching, NonMatching,
        Equivalent or MatchingFor(...), where that word starts and ends in configure.py)."""
        try:
            return self._states_in((self.root / "configure.py").read_text(errors="replace", encoding="utf-8"))
        except OSError:
            return {}

    def src_dir(self) -> str:
        """Where configure.py's source paths start (dtk-template: config.src_dir, "src")."""
        try:
            m = _SRC_DIR.search((self.root / "configure.py").read_text(errors="replace", encoding="utf-8"))
        except OSError:
            m = None
        return (m.group(1) if m else "src").strip("/")

    @staticmethod
    def _states_in(text: str) -> dict[str, tuple[str, int, int]]:
        src_dir = _SRC_DIR.search(text)
        prefix = (src_dir.group(1) if src_dir else "src").strip("/")
        return {f"{prefix}/{m.group(2)}": (m.group(1), m.start(1), m.end(1)) for m in _OBJECT.finditer(text)}

    def linkable(self) -> bool:
        return self.check_target() is not None and bool(self.link_states())

    def marked_matching(self, text: str, sources: list[str], version: str | None) -> str:
        """configure.py (`text`) with these source files (NonMatching in it) marked as linked."""
        states = self._states_in(text)
        # a project that builds several versions links per version where it can say so
        word = (f'MatchingFor("{version}")' if version and len(self.versions()) > 1 and "def MatchingFor" in text
                else "Matching")
        spans = sorted((states[s][1], states[s][2]) for s in sources if s in states and states[s][0] == "NonMatching")
        for start, end in reversed(spans):
            text = text[:start] + word + text[end:]
        return text

    def verify(self, log=lambda *_: None) -> tuple[bool, str]:
        """Build the game and check it against its checksums (regenerating the build when configure.py changed)."""
        target = self.check_target()
        if target is None:
            return False, "this project has no checksum check to run"
        cfg = self.objdiff_config()
        make = cfg.get("custom_make") or "ninja"
        return self.run([_tool(make) or make, *cfg.get("custom_args", []), target], log=log, timeout=1800)

    # ------------------------------------------------------------------ files agents may touch

    def safe_path(self, rel: str, write: bool = False) -> Path:
        p = (self.root / rel).resolve()
        if self.root.resolve() not in p.parents:
            raise ForkError("that path is outside the project")
        parts = set(Path(os.path.relpath(p, self.root.resolve())).parts)
        if write:
            if parts & FORBIDDEN_PARTS or not EDITABLE.search(p.name):
                raise ForkError("agents may only edit C/C++ source and header files, not the project's build setup, "
                                "targets, assembly or tools")
        elif ".git" in parts:
            raise ForkError("that path isn't readable")
        return p

    def git(self, *args: str) -> tuple[bool, str]:
        if not (self.root / ".git").exists() or not shutil.which("git"):
            return False, "not a git checkout"
        res = subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, env=_git_env(self.root),
                             encoding="utf-8", errors="replace")
        return res.returncode == 0, (res.stdout + res.stderr).strip()
