"""Free matches from identical functions: code the game has more than once.

Games are full of functions compiled from the same source: Mario Party 6's 80 minigame modules each link the
same helpers, libraries are inlined into many files, and an SDK's functions are identical from one game to the
next. Two functions are twins when their machine code is the same once the addresses their relocations fill in
are masked (and the relocations are of the same kinds at the same places). A quarter of Mario Party 6's
unmatched functions have a matched twin.

When one twin matches, its code is tried for every other twin, with the names it refers to swapped for the ones
the other twin's relocations name (function and globals by name: `fn_1_3F7C` becomes `fn_1_A2C0`), and the
judge decides, as for any attempt: a twin that only looks the same (other constants, other types) doesn't match.
This runs as the first part of autopilot, and again for a function's twins whenever it matches. No agent time,
no tokens.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from ..elfobj import _MASKS, Reloc, mask_relocs
from ..handwritten import mips_reason, ppc_reason
from ..network import NetworkError

log = logging.getLogger("decomp.wtf")
IDENT = re.compile(r"^[A-Za-z_]\w*$")
_MACHINE = {"EM_PPC": ("ppc", "big"), "EM_MIPS": ("mips", None), "EM_ARM": ("arm", "little")}
_CACHE_VERSION = 2  # of twins.json: 2 added why code is hand-written assembly
# A twin's code that didn't match isn't tried again for this long while neither function's code changes (the
# same source gives the same result): every agent start's pass would otherwise redo hundreds of compiles (Mario
# Party 6: about 900, 15 minutes beside the agents). After a while it's tried again: a header can have changed.
MISS_TTL = 24 * 3600
_GENERATED = ("__dt__", "__ct__", "__sinit", "__vt__")  # C++ code the compiler writes: nothing to copy


@dataclass
class Print:
    """A function's fingerprint: masked code + relocation layout, and what each relocation refers to."""
    key: str
    refs: list[str]  # the name each relocation refers to, in order (sections as ".data" etc.)
    size: int
    addrs: list[int] = field(default_factory=list)  # ROM projects: the address each relocation fills in
    asm: str = ""  # why no compiler makes this code (see handwritten.py), or ""


def _mask(code: bytearray, relocs: list[tuple[int, int]], arch: str, order: str) -> None:
    for off, rtype in relocs:
        delta, length, mask = _MASKS.get((arch, rtype), _MASKS.get(("thumb", rtype), (0, 4, 0xFFFFFFFF)))
        at = off + delta
        if at < 0 or at + length > len(code):
            continue
        val = int.from_bytes(code[at:at + length], order)
        code[at:at + length] = (val & ~mask & ((1 << (8 * length)) - 1)).to_bytes(length, order)


def _key(code: bytes, layout: list[tuple[int, int]]) -> str:
    h = hashlib.sha1(code)
    h.update(repr(layout).encode())
    return h.hexdigest()


def object_prints(data: bytes) -> dict[str, Print]:
    """Fingerprints of every function an object file defines, by symbol (with, for PowerPC, whether its code is
    hand-written assembly)."""
    from elftools.elf.elffile import ELFFile
    from elftools.elf.relocation import RelocationSection

    elf = ELFFile(BytesIO(data))
    arch, order = _MACHINE.get(elf["e_machine"], ("", None))
    order = order or ("little" if elf.little_endian else "big")
    symtab = elf.get_section_by_name(".symtab")
    if symtab is None or not arch:
        return {}
    by_section: dict[int, list] = defaultdict(list)
    for s in symtab.iter_symbols():
        if s["st_info"]["type"] == "STT_FUNC" and isinstance(s["st_shndx"], int) and s["st_size"] > 0 and s.name:
            by_section[s["st_shndx"]].append(s)
    out: dict[str, Print] = {}
    for shndx, syms in by_section.items():
        sec = elf.get_section(shndx)
        if sec["sh_type"] == "SHT_NOBITS":
            continue
        raw = sec.data()
        code = bytearray(raw)
        rels: list[tuple[int, int, str]] = []
        for rs in elf.iter_sections():
            if not isinstance(rs, RelocationSection) or rs["sh_info"] != shndx:
                continue
            table = elf.get_section(rs["sh_link"])
            for r in rs.iter_relocations():
                sym = table.get_symbol(r["r_info_sym"])
                name = elf.get_section(sym["st_shndx"]).name if sym["st_info"]["type"] == "STT_SECTION" and \
                    isinstance(sym["st_shndx"], int) else sym.name
                rels.append((r["r_offset"], r["r_info_type"], name))
        rels.sort()
        _mask(code, [(o, t) for o, t, _ in rels], arch, order)
        for s in syms:
            lo = s["st_value"] & ~1 if arch == "arm" else s["st_value"]
            mine = [(o - lo, t, n) for o, t, n in rels if lo <= o < lo + s["st_size"]]
            out[s.name] = Print(_key(bytes(code[lo:lo + s["st_size"]]), [(o, t) for o, t, _ in mine]),
                                [n for _, _, n in mine], s["st_size"],
                                asm=(ppc_reason(raw[lo:lo + s["st_size"]]) or "") if arch == "ppc" else "")
    return out


def rom_print(fn, arch: str, big_endian: bool, label) -> Print:
    """Fingerprint of a ROM project's function, from its target bytes and the addresses its relocations fill in."""
    relocs = sorted((int(r[0]), int(r[1]), int(r[2])) for r in json.loads(fn["relocs"] or "[]") if len(r) >= 3)
    arch = "thumb" if arch == "arm" else arch  # GBA code is Thumb; its references are bl pairs and literal words
    code = mask_relocs(fn["target"] or b"", [Reloc(o, t, "", 0) for o, t, _ in relocs], arch, big_endian)
    return Print(_key(code, [(o, t) for o, t, _ in relocs]), [label(a) for _, _, a in relocs], len(fn["target"] or b""),
                 [a for _, _, a in relocs])


def rom_renames(syms, source: str, a: Print, b: Print, a_name: str, b_name: str) -> dict[str, str] | None:
    """renames() for a ROM project, where relocations are addresses: for each address a's code refers to, the
    name a's C writes for it (the nearest symbol at or below it that the C mentions: a struct whose field it is,
    an array whose element), and for b the same offset from b's address, by its name or its automatic one."""
    import bisect

    words = set(re.findall(r"\b[A-Za-z_]\w*\b", source))
    out: dict[str, str] = {}
    if a_name != b_name:
        out[a_name] = b_name
    for x, y in zip(a.addrs, b.addrs, strict=False):
        if x == y:
            continue
        i = bisect.bisect_right(syms._starts, x) - 1
        base = None
        for k in range(i, max(-1, i - 64), -1):  # back to the symbol the C writes (at most 64 labels down)
            sym = syms.by_addr[syms._starts[k]]
            if x - sym.address > 0x10000:
                break
            if sym.name in words:
                base = sym
                break
        if base is None:
            continue  # the C doesn't name it (a literal, a string it defines): the judge compares the values
        to = y - (x - base.address)
        other = syms.by_addr.get(to)
        name = other.name if other is not None else f"D_{to:08X}"
        if out.setdefault(base.name, name) != name:
            return None
    return out


def renames(a: Print, b: Print, a_name: str, b_name: str) -> dict[str, str] | None:
    """What to rename in a's code for it to be b's: its own name, and every name a relocation of a refers to,
    to what the same relocation of b refers to. None when that can't be said in C (a name refers to two
    different things, or one side isn't a C name)."""
    out: dict[str, str] = {}
    if a_name != b_name:
        if not (IDENT.match(a_name) and IDENT.match(b_name)):
            return None
        out[a_name] = b_name
    for x, y in zip(a.refs, b.refs, strict=False):
        if x == y:
            continue
        bx, _, ox = x.partition("+")
        by, _, oy = y.partition("+")
        if ox != oy:
            return None  # another field or element: the code differs, not just the names
        if bx.startswith((".", "@")) or by.startswith((".", "@")):
            continue  # a file's own data (literals, statics): the C writes the values, the judge compares them
        if not (IDENT.match(bx) and IDENT.match(by)):
            return None
        if out.setdefault(bx, by) != by:
            return None
    return out


def apply(source: str, names: dict[str, str]) -> str:
    """Rename identifiers in C source, all at once (so a -> b, b -> c doesn't make a into c)."""
    if not names:
        return source
    pattern = re.compile(r"\b(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b")
    return pattern.sub(lambda m: names[m.group(1)], source)


@dataclass
class Job:
    state: str = "running"
    pairs: int = 0
    tried: int = 0
    matched: int = 0
    asm: int = 0  # hand-written assembly (twins of asm functions, code no compiler makes), out of agents' way
    started_at: float = field(default_factory=time.time)
    stop: threading.Event = field(default_factory=threading.Event)
    ordered: threading.Event = field(default_factory=threading.Event)  # assembly set aside, claim order stored


class Twins:
    """Per project: fingerprints (cached), and the work of trying matched code on its twins."""

    def __init__(self, net):
        self.net = net
        self._prints: dict[int, tuple[float, dict[int, Print]]] = {}
        self._lock = threading.Lock()
        self._queue: dict[int, set[int]] = defaultdict(set)  # project id -> newly matched functions to propagate
        self._busy: set[int] = set()
        self._trying: set[int] = set()  # functions a pass is trying now (a full pass and one after a match can overlap)
        self.jobs: dict[str, Job] = {}  # slug -> the full pass (the one the overview shows)

    # ------------------------------------------------------------------ fingerprints

    def prints(self, proj) -> dict[int, Print]:
        """function id -> fingerprint, for every function of the project (ROM: from the database; fork: from the
        target objects, cached in the project's state folder by the objects' modification times)."""
        with self._lock:
            hit = self._prints.get(proj["id"])
        if hit and time.time() - hit[0] < 600:
            return hit[1]
        prints = self._fork_prints(proj) if self.net.fork_slug(proj["slug"]) else self._rom_prints(proj)
        with self._lock:
            self._prints[proj["id"]] = (time.time(), prints)
        return prints

    def _rom_prints(self, proj) -> dict[int, Print]:
        cfg = self.net.cfg(proj)
        syms = self.net.symbols(proj["id"])
        arch = "arm" if cfg.get("platform") == "gba" else proj["arch"] or "mips"
        return {r["id"]: rom_print(r, arch, bool(cfg.get("big_endian", True)), syms.label) for r in self.net.store.all(
            "SELECT id, target, relocs FROM functions WHERE project_id=? AND status NOT IN ('asm', 'library', 'unmatchable')",
            proj["id"])}

    def _fork_prints(self, proj) -> dict[int, Print]:
        from ..forks.project import STATE, ForkError, ForkProject

        fp = ForkProject(Path(proj["root"]))
        cache_path = fp.root / STATE / "twins.json"
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cache = {}
        if cache.get("_v") != _CACHE_VERSION:
            cache = {"_v": _CACHE_VERSION}
        rows = self.net.store.all("SELECT id, name, unit, meta FROM functions WHERE project_id=?", proj["id"])
        by_unit: dict[str, list] = defaultdict(list)
        for r in rows:
            by_unit[r["unit"]].append(r)
        out: dict[int, Print] = {}
        changed = False
        for uname, urows in by_unit.items():
            try:
                unit = fp.unit(uname)
            except (ForkError, ValueError):
                continue
            if unit.target is None or not unit.target.exists():
                continue
            mtime = unit.target.stat().st_mtime
            entry = cache.get(uname)
            if not entry or entry.get("mtime") != mtime:
                try:
                    prints = object_prints(unit.target.read_bytes())
                except Exception:  # noqa: BLE001 an object pyelftools can't read: no twins for it
                    prints = {}
                entry = {"mtime": mtime, "prints": {k: [p.key, p.refs, p.size, p.asm] for k, p in prints.items()}}
                cache[uname] = entry
                changed = True
            for r in urows:
                sym = json.loads(r["meta"] or "{}").get("symbol") or r["name"].split("@")[0]
                p = entry["prints"].get(sym)
                if p:
                    out[r["id"]] = Print(p[0], p[1], p[2], asm=p[3] if len(p) > 3 else "")
        if changed:
            try:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(json.dumps(cache), encoding="utf-8")
            except OSError:
                pass
        return out

    def forget(self, proj) -> None:
        with self._lock:
            self._prints.pop(proj["id"], None)

    # ------------------------------------------------------------------ who's whose twin

    def pairs(self, proj, only: set[int] | None = None, min_size: int = 8) -> list[tuple[int, int]]:
        """(matched function, unmatched twin) pairs to try, the twins of `only` (newly matched ones) or all."""
        prints = self.prints(proj)
        rows = {r["id"]: r for r in self.net.store.all(
            "SELECT id, status FROM functions WHERE project_id=?", proj["id"])}
        groups: dict[str, list[int]] = defaultdict(list)
        for fid, p in prints.items():
            if p.size >= min_size:  # (a lone `blr` is everyone's twin, and its own easy match anyway)
                groups[p.key].append(fid)
        out = []
        for members in groups.values():
            matched = [f for f in members if rows.get(f) and rows[f]["status"] == "matched"]
            if not matched:
                continue
            if only is not None and not set(matched) & only:
                continue
            for f in members:
                if rows.get(f) and rows[f]["status"] == "open":
                    out.append((matched[0], f))
        return out

    def twin_of(self, proj, fid: int) -> int | None:
        """A matched twin of a function, for its brief."""
        prints = self.prints(proj)
        p = prints.get(fid)
        if p is None or p.size < 8:
            return None
        for other, q in prints.items():
            if other != fid and q.key == p.key:
                r = self.net.store.one("SELECT status FROM functions WHERE id=?", other)
                if r and r["status"] == "matched":
                    return other
        return None

    def group_sizes(self, proj) -> dict[int, int]:
        """For each unmatched function: how many unmatched functions share its code (itself included). Matching
        the first of a big group matches the rest for free: those are worth an agent's time first."""
        prints = self.prints(proj)
        rows = {r["id"]: r["status"] for r in self.net.store.all(
            "SELECT id, status FROM functions WHERE project_id=?", proj["id"])}
        groups: dict[str, list[int]] = defaultdict(list)
        for fid, p in prints.items():
            if p.size >= 8:
                groups[p.key].append(fid)
        out = {}
        for members in groups.values():
            if any(rows.get(f) == "matched" for f in members):
                continue
            open_ = [f for f in members if rows.get(f) == "open"]
            for f in open_:
                out[f] = len(open_)
        return out

    def update_boosts(self, proj, pending: bool = False) -> int:
        """Store the claim order twins give (functions.boost): for each group of identical unmatched functions, one
        gets the group's size - 1 (matching it matches the others), the others -1. `pending`: a pass is about to
        try matched code on its unmatched twins, which go last meanwhile (-1): they may be free in a minute.
        Returns how many groups."""
        prints = self.prints(proj)
        rows = {r["id"]: r["status"] for r in self.net.store.all(
            "SELECT id, status FROM functions WHERE project_id=?", proj["id"])}
        groups: dict[str, list[int]] = defaultdict(list)
        for fid, p in prints.items():
            if p.size >= 8:
                groups[p.key].append(fid)
        updates = []
        names = {r["id"]: r["name"] for r in self.net.store.all(
            "SELECT id, name FROM functions WHERE project_id=? AND status='matched'", proj["id"])}
        for members in groups.values():
            open_ = sorted(f for f in members if rows.get(f) == "open")
            matched = [f for f in members if rows.get(f) == "matched"]
            if matched:
                if pending:
                    updates += [(-1, f) for f in open_]
                elif not any(names.get(f, "").startswith(_GENERATED) for f in matched):
                    # its twin's code didn't match by itself (a type or declaration this file lacks, mostly):
                    # an agent starts from it, shown in the brief, so these go first
                    updates += [(1, f) for f in open_]
                continue
            if len(open_) < 2:
                continue
            updates.append((len(open_) - 1, open_[0]))
            updates += [(-1, f) for f in open_[1:]]
        with self.net.store.tx() as db:
            db.execute("UPDATE functions SET boost=0 WHERE project_id=? AND boost!=0", (proj["id"],))
            db.executemany("UPDATE functions SET boost=? WHERE id=?", updates)
        return sum(1 for b, _ in updates if b > 0)

    def set_aside_asm(self, proj) -> int:
        """Unmatched functions whose code no compiler makes (see handwritten.py) get status 'asm': out of agents'
        way. Returns how many."""
        if not self.net.fork_slug(proj["slug"]):
            return self._set_aside_rom_asm(proj)
        prints = self.prints(proj)
        found = [fid for fid, p in prints.items() if p.asm]
        n = 0
        for at in range(0, len(found), 500):
            chunk = found[at:at + 500]
            for r in self.net.store.all(f"SELECT * FROM functions WHERE id IN ({','.join('?' * len(chunk))}) "
                                        "AND status='open'", *chunk):
                self.net.forks.mark_asm(r, reason=prints[r["id"]].asm)
                n += 1
        return n

    def _set_aside_rom_asm(self, proj) -> int:
        """ROM projects on MIPS (N64, PlayStation, PlayStation 2): mips_reason on each open function's code."""
        if (proj["arch"] or "mips") != "mips":
            return 0
        platform, big = self.net.cfg(proj).get("platform", ""), bool(proj["big_endian"])
        marks = []
        for r in self.net.store.all("SELECT id, target, meta FROM functions WHERE project_id=? AND status='open'", proj["id"]):
            if (why := mips_reason(r["target"] or b"", big, platform)):
                marks.append((json.dumps({**json.loads(r["meta"] or "{}"), "asm_code": why}), r["id"]))
        if marks:
            with self.net.store.tx() as db:
                db.executemany("UPDATE functions SET status='asm', meta=? WHERE id=? AND status='open'", marks)
        return len(marks)

    def _full_running(self, slug: str) -> bool:
        return (job := self.jobs.get(slug)) is not None and job.state == "running"

    def refresh(self, slug: str) -> Job | None:
        """Bring a project's twins up to date in the background (see full_pass). Runs when agents start."""
        if (job := self.jobs.get(slug)) is not None and job.state == "running":
            return job
        if slug in self.net.links:  # a room member: the host's copy does this, and its matches come back here
            return None
        job = Job()
        with self._lock:
            self.jobs[slug] = job  # now: agents starting meanwhile wait for its claim order (job.ordered)

        def work() -> None:
            try:
                self.full_pass(slug, job)
            except Exception as e:  # noqa: BLE001
                log.info("twins: %s: %s", slug, e)
                job.state = "done"
        threading.Thread(target=work, daemon=True, name=f"twins-{slug}").start()
        return job

    def full_pass(self, slug: str, job: Job | None = None) -> Job:
        """Hand-written assembly set aside, the claim order (agents claim in it from the start, not after the pass),
        matched code tried on every unmatched twin, the claim order again. One at a time per project: while one runs
        (agents started it, say), a second call waits for it."""
        with self._lock:
            running = self.jobs.get(slug)
            if running is not None and running.state == "running" and running is not job:
                job, mine = running, False
            else:
                job, mine = job or Job(), True
                self.jobs[slug] = job
        if not mine:
            while job.state == "running":
                time.sleep(1)
            return job
        try:
            proj = self.net.project_row(slug)
            job.asm += self.set_aside_asm(proj)
            self.update_boosts(proj, pending=True)
            job.ordered.set()
            self.run(slug, job)
            self.update_boosts(self.net.project_row(slug))
        finally:
            job.ordered.set()
            if job.state == "running":  # (it failed before the pass)
                job.state = "stopped" if job.stop.is_set() else "done"
        return job

    def source_for(self, proj, a, b, includes: bool = False) -> str | None:
        """a's code made into b's (names swapped as their relocations say), or None if that can't be said.
        `includes`: (forks) bring a's file's includes along too."""
        prints = self.prints(proj)
        pa, pb = prints.get(a["id"]), prints.get(b["id"])
        if pa is None or pb is None or pa.key != pb.key:
            return None
        if self.net.fork_slug(proj["slug"]):
            names = self._fork_names(pa, pb, a, b)
            if names is None:
                return None
            return self.net.forks.twin_source(proj, a, b, names, includes)
        source = a["matched_source"]
        if not source:
            return None
        names = rom_renames(self.net.symbols(proj["id"]), source, pa, pb, a["name"], b["name"])
        if names is None:
            return None
        # what the header declares for a's names, declared for b's too (`extern Player g_player;` for D_80047000)
        header = self.net._context(proj["id"], b["unit"])["header"]
        decls = []
        for old_name, new_name in names.items():
            if old_name == a["name"] or re.search(rf"\b{re.escape(new_name)}\b", header):
                continue
            line = next((ln.strip() for ln in header.splitlines() if re.search(rf"\b{re.escape(old_name)}\b", ln)
                         and ln.strip().endswith(";") and "{" not in ln and not ln.strip().startswith(("#", "//", "/*"))),
                        None)
            if line:
                decls.append(apply(line, {old_name: new_name}))
        return "\n".join(decls) + ("\n" if decls else "") + apply(source, names)

    @staticmethod
    def _fork_names(pa: Print, pb: Print, a, b) -> dict[str, str] | None:
        meta_a, meta_b = json.loads(a["meta"] or "{}"), json.loads(b["meta"] or "{}")
        return renames(pa, pb, meta_a.get("symbol") or a["name"], meta_b.get("symbol") or b["name"])

    # ------------------------------------------------------------------ the work

    def try_pair(self, agent, proj, a_id: int, b_id: int) -> str:
        """match | miss | asm | skip, for a's matched code on its twin b."""
        a = self.net.store.one("SELECT * FROM functions WHERE id=?", a_id)
        b = self.net.store.one("SELECT * FROM functions WHERE id=?", b_id)
        if a is None or b is None or a["status"] != "matched" or b["status"] != "open":
            return "skip"
        if self.net.store.one("SELECT 1 FROM claims WHERE function_id=?", b_id):
            return "skip"  # an agent is on it: its brief names the twin (see twin_of)
        with self._lock:
            if b_id in self._trying:
                return "skip"
            self._trying.add(b_id)
        try:
            return self._try_pair(agent, proj, a, b)
        finally:
            with self._lock:
                self._trying.discard(b_id)

    @staticmethod
    def _miss_key(source: str) -> str:
        return hashlib.sha1(source.encode("utf-8", "replace")).hexdigest()[:20]

    def _missed(self, b_id: int, source: str) -> bool:
        return self.net.store.one("SELECT 1 FROM twin_misses WHERE function_id=? AND source_hash=? AND at > ?",
                                  b_id, self._miss_key(source), time.time() - MISS_TTL) is not None

    def known_miss(self, proj, a_id: int, b_id: int) -> bool:
        """Whether a's code was tried on b, as it is now, and didn't match (see MISS_TTL)."""
        a = self.net.store.one("SELECT * FROM functions WHERE id=?", a_id)
        b = self.net.store.one("SELECT * FROM functions WHERE id=?", b_id)
        if a is None or b is None:
            return False
        try:
            source = self.source_for(proj, a, b)
        except (NetworkError, OSError, ValueError):
            return False
        return bool(source) and self._missed(b_id, source)

    def _try_pair(self, agent, proj, a, b) -> str:
        try:
            source = self.source_for(proj, a, b)
        except (NetworkError, OSError, ValueError) as e:
            log.info("twins: %s from %s not tried: %s", b["name"], a["name"], str(e)[:300])
            return "skip"
        if not source:
            if self.net.fork_slug(proj["slug"]) and self.net.forks.is_asm(proj, a):
                self.net.forks.mark_asm(b, a["name"])
                return "asm"
            return "skip"
        if self._missed(b["id"], source):
            return "known"
        outcome, why = self._attempt_twin(agent, proj, a, b, source)
        if outcome == "miss":
            with self.net.store.tx() as db:
                db.execute("INSERT OR REPLACE INTO twin_misses(function_id, source_hash, project_id, at, why) "
                           "VALUES(?,?,?,?,?)", (b["id"], self._miss_key(source), proj["id"], time.time(), why))
        return outcome

    def miss_why(self, b_id: int) -> str | None:
        """What the last try of its twin's code said (the compiler's first error, or how close it came)."""
        row = self.net.store.one("SELECT why FROM twin_misses WHERE function_id=? ORDER BY at DESC LIMIT 1", b_id)
        return row["why"] if row else None

    @staticmethod
    def _why(res: dict) -> str:
        """The gist of a try that didn't match: the compiler's first error, or how close it came."""
        if res.get("score") is None:
            lines = [ln.strip(" #") for ln in (res.get("text") or "").splitlines()
                     if re.search(r"undefined|undeclared|expected|illegal|redefin|not a |declaration|conversion", ln)]
            return (lines[0] if lines else "it didn't build")[:300]
        return (res.get("text") or "").splitlines()[0][:300] if res.get("text") else f"score {res.get('score')}"

    def _attempt_twin(self, agent, proj, a, b, source: str) -> tuple[str, str]:
        note = f"/* identical to {a['name']} (matched), with its names changed by decomp.wtf */\n"
        try:
            if self.net.fork_slug(proj["slug"]):
                forks, slug, src, prelude = self.net.forks, proj["slug"], source, ""
                res = forks.attempt(agent, slug, b["name"], note + src, keep=False)
                if res.get("score") is None and (types := forks.twin_types(proj, a, b, src)):  # a type a's file has
                    prelude = types
                    res = forks.attempt(agent, slug, b["name"], note + src, keep=False, prelude=prelude)
                if res.get("score") is None and (more := self.source_for(proj, a, b, includes=True)) and more != src:
                    src, prelude = more, forks.twin_types(proj, a, b, more)
                    res = forks.attempt(agent, slug, b["name"], note + src, keep=False, prelude=prelude)
                if res.get("score") is not None and not res.get("percent") and (c := forks.c_linkage(proj, a, b, src)):
                    src = c  # built, but nothing of it in the object: C code in a C++ file, its name mangled
                    res = forks.attempt(agent, slug, b["name"], note + src, keep=False, prelude=prelude)
                # the compiler names one undeclared name per build (a callee b's file declares further down, say):
                # declared as the files declare it, then built again
                prints, decls = self.prints(proj), []
                names = self._fork_names(prints[a["id"]], prints[b["id"]], a, b) if a["id"] in prints and b["id"] in prints else None
                for _ in range(4):
                    m = names is not None and res.get("score") is None and \
                        re.search(r"undefined identifier '(\w+)'", res.get("text") or "")
                    if not m:
                        break
                    decl = forks.twin_declaration(proj, a, b, m.group(1), names)
                    if not decl or decl in decls:
                        break
                    decls.append(decl)  # after the file's includes: also when the file declares it further down
                    res = forks.attempt(agent, slug, b["name"], note + src, keep=False,
                                        prelude="\n".join([prelude, *decls]).strip("\n"))
            else:
                res = self.net.try_quietly(agent, proj, b, note + source)
        except NetworkError as e:
            log.info("twins: %s from %s: %s", b["name"], a["name"], str(e)[:300])
            return "skip", ""
        return ("match", "") if res.get("matched") else ("miss", self._why(res))

    def run(self, slug: str, job: Job | None = None, only: set[int] | None = None, workers: int = 3) -> Job:
        """Try matched code on every unmatched twin (or the twins of `only`), until a pass matches nothing new
        (a twin that matches can be the matched member of another group's pair next time)."""
        from concurrent.futures import ThreadPoolExecutor

        proj = self.net.project_row(slug)
        job = job or Job()
        if only is None:  # (a pass after a match runs beside the full one: the overview shows the full one)
            self.jobs[slug] = job
            job.ordered.set()
        agent, _ = self.net.local_agent("autopilot")
        if self.net.fork_slug(slug):
            workers = min(workers, 2)  # each try builds a file
        seen: set[tuple[int, int]] = set()
        try:
            for _ in range(6):
                tried = {q[1] for q in seen}
                pairs = [p for p in self.pairs(proj, only) if p not in seen and p[1] not in tried]
                if not pairs or job.stop.is_set():
                    break
                seen |= set(pairs)
                job.pairs += len(pairs)
                before = job.matched

                fresh: set[int] = set()

                def one(pair: tuple[int, int], fresh=fresh) -> None:  # `fresh`: bind this pass's set
                    if job.stop.is_set():
                        return
                    try:
                        outcome = self.try_pair(agent, proj, *pair)
                    except Exception as e:  # noqa: BLE001 one odd function must not stop the rest
                        log.info("twins: %s failed: %s", pair, e)
                        outcome = "skip"
                    job.tried += outcome not in ("skip", "asm", "known")
                    job.matched += outcome == "match"
                    job.asm += outcome == "asm"
                    if outcome == "match":
                        fresh.add(pair[1])

                by_target: dict[int, tuple[int, int]] = {}
                for p in pairs:  # one try per unmatched function, unless its twin's code already failed on it
                    if p[1] not in by_target and not self.known_miss(proj, *p):
                        by_target[p[1]] = p
                with self.net.store.tx() as db:  # agents leave these for last meanwhile: they may be free in a minute
                    db.executemany("UPDATE functions SET boost=-1 WHERE id=? AND status='open'", [(b,) for b in by_target])
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    list(pool.map(one, by_target.values()))
                if job.matched == before:
                    break
                if only is not None:
                    only = fresh  # the next pass: twins of what this one matched (a whole run already covered all)
        finally:
            job.state = "stopped" if job.stop.is_set() else "done"
            if job.matched:
                with self.net.store.tx() as db:
                    self.net._event(db, proj["id"], agent.id, "autopilot",
                                    f"{job.matched} functions matched from identical code elsewhere in the game")
        return job

    def after_match(self, proj, fid: int) -> None:
        """A function just matched: try its code on its twins soon, in the background (debounced per project, so
        a burst of matches is one pass)."""
        if proj["slug"] in self.net.links:
            return
        with self._lock:
            self._queue[proj["id"]].add(fid)
            if proj["id"] in self._busy:
                return
            self._busy.add(proj["id"])

        def work() -> None:
            try:
                while True:
                    time.sleep(2)
                    with self._lock:
                        batch = self._queue.pop(proj["id"], set())
                        if not batch:
                            self._busy.discard(proj["id"])
                            return
                    if self.net.fork_slug(proj["slug"]):
                        self.forget(proj)  # matched code may have changed the objects' builds; targets stay
                    try:
                        if self.pairs(proj, batch):
                            self.run(proj["slug"], only=batch)
                            # twins that didn't match by themselves: back in line (unless a full pass is still on)
                            self.update_boosts(proj, pending=self._full_running(proj["slug"]))
                    except Exception as e:  # noqa: BLE001
                        log.info("twins after a match: %s", e)
            finally:
                with self._lock:
                    self._busy.discard(proj["id"])

        threading.Thread(target=work, daemon=True, name=f"twins-{proj['slug']}").start()
