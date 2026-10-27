"""A dtk-template project's file layout, edited the way contributors edit it.

Which bytes of the game come from which source file is set in splits.txt (one per module: the DOL and each REL);
configure.py lists the source files with their compiler settings and whether they're linked. Code dtk found but no
file covers yet is split off automatically (auto_00_00000000_text): nobody can write C for it until a file covers
it. These helpers parse and write both files; the fork engine decides what to change and keeps a change only when
the game still builds byte for byte.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_FILE = re.compile(r"^(\S.*?):\s*$")
_RANGE = re.compile(r"^\s+(\.\S+)\s+start:(0x[0-9A-Fa-f]+)\s+end:(0x[0-9A-Fa-f]+)(.*)$")
_STRING = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')
_OBJ_ENTRY = re.compile(r'\bObject\(\s*(NonMatching|Matching|Equivalent|MatchingFor\([^()]*\))\s*,\s*"([^"]+)"', re.DOTALL)


@dataclass
class FileSplit:
    name: str  # path relative to the source directory, as splits.txt names it
    sections: dict[str, tuple[int, int]] = field(default_factory=dict)  # ".text" -> (start, end)
    extra: dict[str, str] = field(default_factory=dict)  # anything after a range (align:, rename:...), kept as is
    attrs: list[str] = field(default_factory=list)  # other lines of the entry (comment:, ...)


@dataclass
class Splits:
    header: str  # everything before the first file (the Sections: block)
    files: list[FileSplit]

    @staticmethod
    def parse(text: str) -> Splits:
        lines = text.splitlines()
        header: list[str] = []
        files: list[FileSplit] = []
        cur: FileSplit | None = None
        for line in lines:
            m = _FILE.match(line)
            if m and m.group(1) != "Sections":
                cur = FileSplit(m.group(1))
                files.append(cur)
                continue
            if cur is None:
                header.append(line)
                continue
            r = _RANGE.match(line)
            if r:
                cur.sections[r.group(1)] = (int(r.group(2), 16), int(r.group(3), 16))
                if r.group(4).strip():
                    cur.extra[r.group(1)] = r.group(4).strip()
            elif line.strip():
                cur.attrs.append(line)
        while header and not header[-1].strip():
            header.pop()
        return Splits("\n".join(header), files)

    def render(self) -> str:
        out = [self.header, ""]
        for f in self.files:
            out.append(f"{f.name}:")
            out += f.attrs
            for sec, (start, end) in f.sections.items():
                tail = f" {f.extra[sec]}" if sec in f.extra else ""
                out.append(f"\t{sec:<11} start:0x{start:08X} end:0x{end:08X}{tail}")
            out.append("")
        return "\n".join(out)

    def owner(self, section: str, address: int) -> FileSplit | None:
        for f in self.files:
            lo, hi = f.sections.get(section, (0, 0))
            if lo <= address < hi:
                return f
        return None


@dataclass
class Module:
    name: str  # "main" for the DOL, else the REL's name (as objdiff.json's unit names start)
    splits: Path
    symbols: Path


def modules(root: Path, version: str) -> dict[str, Module]:
    """The program and its RELs, from config/<version>/config.yml."""
    cfg = yaml.safe_load((root / "config" / version / "config.yml").read_text(encoding="utf-8"))
    out = {}
    if cfg.get("splits"):
        out["main"] = Module("main", root / cfg["splits"], root / cfg.get("symbols", ""))
    for m in cfg.get("modules") or []:
        if m.get("splits"):
            out[Path(m["object"]).stem] = Module(Path(m["object"]).stem, root / m["splits"], root / m.get("symbols", ""))
    return out


_SYMBOL = re.compile(r"^(\S+)\s*=\s*(\.\w+):(0x[0-9A-Fa-f]+);(.*)$")


def symbols(path: Path) -> dict[str, tuple[str, int, int]]:
    """symbols.txt: name -> (section, address, size)."""
    out = {}
    try:
        lines = path.read_text(errors="replace", encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        m = _SYMBOL.match(line)
        if m:
            size = re.search(r"size:(0x[0-9A-Fa-f]+)", m.group(4))
            out[m.group(1)] = (m.group(2), int(m.group(3), 16), int(size.group(1), 16) if size else 0)
    return out


# ------------------------------------------------------------------ configure.py

def _skip_string(text: str, i: int) -> int:
    m = _STRING.match(text, i)
    return m.end() if m else i + 1


def _match(text: str, i: int) -> int:
    """Index after the bracket closing the one at text[i]."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    stack = [pairs[text[i]]]
    j = i + 1
    while j < len(text) and stack:
        c = text[j]
        if c in "\"'":
            j = _skip_string(text, j)
            continue
        if c == "#":
            j = text.find("\n", j)
            j = len(text) if j < 0 else j
            continue
        if c in pairs:
            stack.append(pairs[c])
        elif c == stack[-1]:
            stack.pop()
        j += 1
    return j


@dataclass
class Lib:
    name: str
    start: int  # the item's span in configure.py (without the trailing comma)
    end: int
    objects: list[tuple[str, int, int]]  # (source path, entry start, entry end) for each Object(...)
    body: tuple[int, int] | None  # span inside the objects container's brackets


def libs(text: str) -> list[Lib]:
    """The items of `config.libs = [...]`: one per library, a dict or a helper call (Rel("m656DLL", objects=...))."""
    m = re.search(r"^config\.libs\s*=\s*\[", text, re.MULTILINE)
    if not m:
        return []
    end = _match(text, m.end() - 1) - 1
    out = []
    i = m.end()
    while i < end:
        c = text[i]
        if c in " \t\r\n,":
            i += 1
            continue
        if c == "#":
            i = text.find("\n", i)
            continue
        start = i
        while i < end and text[i] not in "({[":
            i += 1
        stop = _match(text, i) if i < end else end
        item = text[start:stop]
        name = re.search(r'"lib"\s*:\s*"([^"]+)"', item) or re.search(r'^\w+\(\s*"([^"]+)"', item)
        objs = []
        for o in _OBJ_ENTRY.finditer(item):
            s = start + o.start()
            objs.append((o.group(2), s, _match(text, text.index("(", s))))
        body = None
        k = re.search(r'(?:"objects"\s*:|\bobjects\s*=)\s*([\[{(])', item)
        if k:
            open_at = start + k.start(1)
            body = (open_at + 1, _match(text, open_at) - 1)
        out.append(Lib(name.group(1) if name else "", start, stop, objs, body))
        i = stop
    return out


def _usual_tail(text: str, entries: list[tuple[str, int, int]]) -> str:
    """The settings most of these Object(...) entries share after their path (extra_cflags=...), for a new one."""
    from collections import Counter

    tails = Counter()
    for _, start, end in entries:
        m = _OBJ_ENTRY.match(text, start)
        if m:  # the same settings, however they're wrapped over lines
            tails[re.sub(r"\s+", " ", text[m.end():end - 1]).strip().rstrip(",").rstrip()] += 1
    if not tails:
        return ""
    tail, n = tails.most_common(1)[0]
    return tail if n * 2 >= sum(tails.values()) else ""


def _indent_of(text: str, at: int) -> str:
    line_start = text.rfind("\n", 0, at) + 1
    return re.match(r"[ \t]*", text[line_start:]).group(0)


def add_objects(text: str, module: str, sources: list[str]) -> str:
    """configure.py with Object(NonMatching, ...) entries for `sources` (paths relative to the source directory):
    in the library whose files share the most of their directory, else in a new library for the module made like
    its nearest sibling (a REL's library like another REL's)."""
    for src in sources:
        all_libs = libs(text)
        if any(p == src for lib in all_libs for p, _, _ in lib.objects):
            continue  # listed already (dtk-template leaves a file out of objdiff.json until it exists)
        folder = str(Path(src).parent)

        def shared(lib: Lib, folder=folder) -> int:  # `folder`: bind this file's folder
            best = 0
            for path, _, _ in lib.objects:
                a, b = Path(path).parent.parts, Path(folder).parts
                n = 0
                while n < min(len(a), len(b)) and a[n] == b[n]:
                    n += 1
                best = max(best, n)
            return best

        own = [lib for lib in all_libs if lib.name == module or any(str(Path(p).parent) == folder for p, _, _ in lib.objects)]
        if own and own[0].objects:
            lib = own[0]
            siblings = [o for o in lib.objects if str(Path(o[0]).parent) == folder] or lib.objects
            _, _, last_end = max(siblings, key=lambda o: o[2])
            indent = _indent_of(text, lib.objects[-1][1])
            tail = _usual_tail(text, siblings)
            text = text[:last_end] + f",\n{indent}Object(NonMatching, \"{src}\"{tail})" + text[last_end:]
            continue
        # a new library, made like the closest one with REL (or program) files and an objects list
        rel = module != "main"
        candidates = [lib for lib in all_libs if lib.body and lib.objects
                      and all(p.startswith("REL/") == rel for p, _, _ in lib.objects)]
        if not candidates:
            raise ValueError("configure.py has no library to model a new one on")
        # another module's own library (Rel("m602Dll"): REL/m602Dll/...) is built like this module; the nearest
        # name first (neighbouring RELs are built alike), else the library sharing the most of the folder
        own_libs = sorted((lib for lib in candidates if lib.name and all(
            Path(p).parts[:2] == ("REL", lib.name) for p, _, _ in lib.objects)), key=lambda lib: lib.name.lower())
        if rel and own_libs:
            names = [lib.name.lower() for lib in own_libs]
            import bisect

            k = bisect.bisect_left(names, module.lower())
            tmpl = own_libs[min(k, len(own_libs) - 1)]
        else:
            tmpl = max(candidates, key=shared)
        block = text[tmpl.start:tmpl.end]
        indent = _indent_of(text, tmpl.objects[0][1])
        close_indent = _indent_of(text, tmpl.body[1]) if text[tmpl.body[1]] in ")]}" else indent[:-4]
        b0, b1 = tmpl.body[0] - tmpl.start, tmpl.body[1] - tmpl.start
        tail = _usual_tail(text, tmpl.objects)
        new = block[:b0] + f"\n{indent}Object(NonMatching, \"{src}\"{tail}),\n{close_indent}" + block[b1:]
        new = new.replace(f'"{tmpl.name}"', f'"{module}"', 1) if tmpl.name else new
        text = text[:tmpl.end] + ",\n" + _indent_of(text, tmpl.start) + new + text[tmpl.end:]
    return text
