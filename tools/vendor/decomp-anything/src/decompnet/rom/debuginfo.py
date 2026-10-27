"""Debug information already in the user's files: names, sizes, structs and function signatures.

A binary often comes with more than its bytes: a PDB beside a Windows program, DWARF sections in a
Linux program, or the MAP file a linker wrote. decomp.wtf uses them to replace automatic names
(sub_... / func_...) with the names the original compiler knew, and to hand agents the project's
types. Nothing is uploaded and nothing is executed: PDB text comes from llvm-pdbutil (part of LLVM),
DWARF is read with pyelftools, and MAP / symbol_addrs.txt are plain text.

Exports are deliberately simple and portable: `symbol_addrs.txt` (splat's format) and `debug_types.h`
(C declarations). Both can be read again by other tools and by decomp.wtf.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import struct
import subprocess
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from .symbols import IDENT, Symbol

MAX_HEADER = 256 * 1024
MAX_TYPES = 4000


class DebugInfoError(ValueError):
    pass


@dataclass
class DebugFunction:
    name: str
    address: int
    size: int = 0
    signature: str = ""
    kind: str = "func"


@dataclass
class DebugType:
    name: str
    kind: str  # struct | union | enum | typedef
    size: int = 0
    declaration: str = ""


@dataclass
class DebugInfo:
    source: str
    symbols: list[Symbol] = field(default_factory=list)
    functions: list[DebugFunction] = field(default_factory=list)
    types: list[DebugType] = field(default_factory=list)
    header: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def count(self) -> dict:
        return {"symbols": len(self.symbols), "functions": len(self.functions), "types": len(self.types)}


# ------------------------------------------------------------------ public entry points

def read(path: str | Path, *, data: bytes | None = None, image=None) -> DebugInfo:
    """Read one debug file. `.pdb`, `.map`, `symbol_addrs.txt` and ELF DWARF are understood; a PE/ELF
    path without a suffix tries its sidecar debug file."""
    path = Path(path).expanduser()
    if data is None and path.is_file():
        data = path.read_bytes()
    if data is None:
        raise DebugInfoError(f"no file at {path}")
    suffix = path.suffix.lower()
    if suffix == ".pdb":
        return _read_pdb(path, image)
    if suffix in (".map", ".txt", ".sym", ".symbols"):
        text = data.decode("utf-8", "replace")
        if suffix == ".map" or _looks_like_map(text):
            return _read_map(text, image)
        return _read_symbol_addrs(text, path.name)
    if suffix == ".json":
        return _read_json(data, path.name)
    if data[:4] == b"\x7fELF":
        return _read_dwarf(data, path.name, image)
    if _is_pe(data):
        sidecar = find_pdb(path, data)
        if sidecar is None:
            raise DebugInfoError(f"no PDB beside {path.name} (looked for a CodeView path, {path.stem}.pdb and *.pdb)")
        return _read_pdb(sidecar, image)
    if _is_pe(data) or path.is_file():
        raise DebugInfoError(f"don't know how to read debug information from {path.name}")
    raise DebugInfoError(f"{path.name} isn't a PDB, MAP, symbol list or ELF program")


def discover(path: str | Path, data: bytes | None = None, *, image=None) -> DebugInfo | None:
    """The debug information that came with a program, if any: an ELF's DWARF or a PE's PDB/MAP."""
    path = Path(path).expanduser()
    try:
        if data is None and path.is_file():
            data = path.read_bytes()
        if data is None:
            return None
        if data[:4] == b"\x7fELF" and _has_debug_info(data):
            return _read_dwarf(data, path.name)
        if _is_pe(data):
            pdb = find_pdb(path, data)
            if pdb is not None:
                return _read_pdb(pdb, image)
            for suffix in (".map", ".MAP"):
                candidate = path.with_suffix(suffix)
                if candidate.is_file():
                    return _read_map(candidate.read_text(encoding="utf-8", errors="replace"), image=image)
    except (DebugInfoError, OSError, ValueError):
        return None
    return None


def find_pdb(exe: str | Path, data: bytes) -> Path | None:
    """The PDB named by the PE's CodeView record, or one next to it. Also accepts a bare `.pdb`."""
    exe = Path(exe)
    candidates: list[Path] = []
    name = _pe_debug_path(data)
    if name:
        raw = Path(name)
        candidates += [exe.parent / raw.name, exe.parent / raw]
    candidates += [exe.with_suffix(".pdb"), exe.with_suffix(".PDB")]
    seen = set()
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        if c.is_file():
            return c
    return None


# ------------------------------------------------------------------ symbol_addrs.txt

_EQ = re.compile(r"^\s*([A-Za-z_]\w*)\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*;?\s*(?://\s*(.*))?$")
_KIND = re.compile(r"type\s*:\s*(func|function|data|string|jtbl|bss)", re.IGNORECASE)
_SIZE = re.compile(r"size\s*:\s*(0x[0-9A-Fa-f]+|\d+)", re.IGNORECASE)


def _read_symbol_addrs(text: str, source: str = "symbol_addrs.txt") -> DebugInfo:
    symbols: list[Symbol] = []
    seen: set[str] = set()
    for line in text.splitlines():
        if line.lstrip().startswith(("//", "#", ";")):
            continue
        m = _EQ.match(line)
        if not m:
            continue
        name, addr, comment = m.group(1), int(m.group(2), 0), m.group(3) or ""
        if name in seen:
            continue
        seen.add(name)
        kind = (_KIND.search(comment) or [None, "data"])[1].lower()
        kind = {"function": "func"}.get(kind, kind)
        size = int(_SIZE.search(comment).group(1), 0) if _SIZE.search(comment) else 0
        symbols.append(Symbol(name, addr, size, kind))
    return DebugInfo(source, symbols=symbols)


def _looks_like_map(text: str) -> bool:
    return bool(re.search(r"^\s*(?:0x[0-9A-Fa-f]+\s+\w+|[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}\s+\S+)", text, re.MULTILINE))


# ------------------------------------------------------------------ MAP files

_GNU_MAP = re.compile(r"^\s*(0x[0-9A-Fa-f]+)\s+([A-Za-z_.$][\w.$@]*)\s*$")
_MSVC_MAP = re.compile(r"^\s*[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}\s+(\S+)\s+([0-9A-Fa-f]{8,16})\s+(\S+)")


def _read_map(text: str, image=None) -> DebugInfo:
    """GNU ld and MSVC MAP files: symbol name, address and (MSVC) size/object."""
    symbols: list[Symbol] = []
    seen: set[str] = set()
    functions = {int(f.vram) for f in getattr(image, "functions", [])}
    for line in text.splitlines():
        m = _MSVC_MAP.match(line)
        if m:
            name, addr, _obj = m.group(1), int(m.group(2), 16), m.group(3)
            if name in seen or (name.startswith("??") and not IDENT.match(name.lstrip("?"))):
                continue
            seen.add(name)
            kind = "func" if addr in functions else "data"
            symbols.append(Symbol(name, addr, 0, kind))
            continue
        m = _GNU_MAP.match(line)
        if m:
            addr, name = int(m.group(1), 16), m.group(2)
            if name in seen or name in ("LOAD", "PROVIDE", "ASSERT", "ALIGN"):
                continue
            seen.add(name)
            symbols.append(Symbol(name, addr, 0, "func" if addr in functions else "data"))
    if not symbols:
        raise DebugInfoError("the MAP file has no symbol lines this reader recognises")
    return DebugInfo(source="MAP", symbols=symbols)


# ------------------------------------------------------------------ JSON export

def _read_json(data: bytes, source: str) -> DebugInfo:
    try:
        obj = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise DebugInfoError(f"not a debug JSON file: {e}") from e
    symbols = [Symbol(str(s["name"]), int(s["address"], 0) if isinstance(s["address"], str) else int(s["address"]),
                      int(s.get("size") or 0), str(s.get("kind") or "data"))
               for s in obj.get("symbols", []) if s.get("name") and s.get("address") is not None]
    header = str(obj.get("header") or "")
    return DebugInfo(source, symbols=symbols, header=header)


# ------------------------------------------------------------------ export

def symbol_addrs_text(symbols: list[Symbol]) -> str:
    lines = ["// decomp.anything symbol export: name = address; // type:kind size:..."]
    for s in sorted(symbols, key=lambda x: (x.address, x.name)):
        if not IDENT.match(s.name):
            continue
        extra = f" // type:{s.kind}" + (f" size:0x{s.size:X}" if s.size else "")
        lines.append(f"{s.name} = 0x{s.address:08X};{extra}")
    return "\n".join(lines) + "\n"


def symbols_json(symbols: list[Symbol], functions: list[DebugFunction] | None = None,
                 types: list[DebugType] | None = None) -> str:
    return json.dumps({"symbols": [{"name": s.name, "address": f"0x{s.address:X}", "size": s.size, "kind": s.kind}
                                   for s in symbols],
                       "functions": [{"name": f.name, "address": f"0x{f.address:X}", "size": f.size,
                                      "signature": f.signature} for f in functions or []],
                       "types": [{"name": t.name, "kind": t.kind, "size": t.size,
                                  "declaration": t.declaration} for t in types or []]}, indent=1) + "\n"


# ------------------------------------------------------------------ PE CodeView path

def _is_pe(data: bytes) -> bool:
    if len(data) < 0x40 or data[:2] != b"MZ":
        return False
    at = struct.unpack_from("<I", data, 0x3C)[0]
    return 0 < at <= len(data) - 24 and data[at:at + 4] == b"PE\0\0"


def _pe_debug_path(data: bytes) -> str:
    """The CodeView PDB path recorded in a PE, if it has one."""
    try:
        at = struct.unpack_from("<I", data, 0x3C)[0]
        machine = struct.unpack_from("<H", data, at + 4)[0]
        nsect = struct.unpack_from("<H", data, at + 6)[0]
        opt = at + 24
        plus = machine in (0x8664, 0xAA64)
        ndirs_at = opt + (108 if plus else 92)
        ndirs = struct.unpack_from("<I", data, ndirs_at)[0]
        dirs_at = ndirs_at + 4
        if ndirs <= 6:
            return ""
        debug_rva, debug_size = struct.unpack_from("<II", data, dirs_at + 8 * 6)
        if not debug_rva or not debug_size:
            return ""
        secs = []
        sec_at = opt + struct.unpack_from("<H", data, at + 20)[0]
        for i in range(nsect):
            off = sec_at + 40 * i
            raw_size, raw_ptr = struct.unpack_from("<II", data, off + 16)
            va = struct.unpack_from("<I", data, off + 12)[0]
            secs.append((va, raw_size, raw_ptr))
        def rva_ptr(rva: int) -> int | None:
            for va, size, ptr in secs:
                if va <= rva < va + max(size, 1):
                    return ptr + rva - va
            return None
        base = rva_ptr(debug_rva)
        if base is None:
            return ""
        for k in range(debug_size // 28):
            o = base + 28 * k
            if o + 28 > len(data):
                break
            kind, size, _addr, ptr = struct.unpack_from("<IIII", data, o + 12)
            if kind != 2 or not size or not ptr:
                continue
            blob = data[ptr:ptr + size]
            if blob[:4] == b"RSDS" and len(blob) >= 24:
                return blob[24:].split(b"\0", 1)[0].decode("utf-8", "replace")
    except (struct.error, IndexError, ValueError):
        return ""
    return ""


# ------------------------------------------------------------------ PDB through llvm-pdbutil

def _pdbutil() -> str | None:
    configured = os.environ.get("DECOMP_PDBUTIL") or os.environ.get("LLVM_PDBUTIL")
    if configured and Path(configured).expanduser().is_file():
        return str(Path(configured).expanduser())
    env = shutil.which("llvm-pdbutil")
    if env:
        return env
    for name in ("clang-cl", "clang", "clang++"):
        exe = shutil.which(name)
        if exe:
            p = Path(exe).with_name("llvm-pdbutil" + (".exe" if name.endswith(".exe") else ""))
            if p.is_file():
                return str(p)
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if directory:
            for candidate in sorted(Path(directory).glob("llvm-pdbutil*")):
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate)
    for base in sorted(Path("/usr/lib").glob("llvm-*/bin/llvm-pdbutil")):
        if base.is_file():
            return str(base)
    return None


def _read_pdb(path: Path, image=None) -> DebugInfo:
    tool = _pdbutil()
    if tool is None:
        raise DebugInfoError("PDB import needs llvm-pdbutil (it ships with LLVM). Install LLVM, or use a MAP file.")
    try:
        res = subprocess.run([tool, "dump", "-section-headers", "-symbols", "-types", "-publics", str(path)],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        raise DebugInfoError(f"couldn't run llvm-pdbutil: {e}") from e
    if res.returncode != 0 and not res.stdout.strip():
        raise DebugInfoError((res.stderr or res.stdout).strip()[-1000:] or "llvm-pdbutil failed")
    text = res.stdout + "\n" + res.stderr
    info = _parse_pdb(text, image)
    info.source = f"PDB {path.name}"
    return info


_SECTION = re.compile(r"^\s*SECTION HEADER #(\d+)\s*$")
_PDB_VA = re.compile(r"^\s*([0-9A-Fa-f]+) virtual address\s*$")
_PDB_VSIZE = re.compile(r"^\s*([0-9A-Fa-f]+) virtual size\s*$")
_PDB_SYM = re.compile(r"^\s*(?:\d+\s+\|\s*)?(S_[A-Z0-9_]+)\s+\[size = \d+\]\s+`([^`]*)`")
_PDB_ADDR = re.compile(r"addr = ([0-9A-Fa-f]{4}):([0-9A-Fa-f]+)")
_PDB_SIZE = re.compile(r"code size = (\d+)")
_PDB_TYPE = re.compile(r"type = `([^`]*)`")
_TYPE = re.compile(r"^\s*0x([0-9A-Fa-f]+) \| (LF_[A-Z_]+) \[size = \d+\](?:\s+`([^`]*)`)?")
_MEMBER = re.compile(r"- LF_MEMBER \[name = `([^`]*)`, Type = 0x([0-9A-Fa-f]+)(?: \(([^)]*)\))?, offset = (\d+)")
_ENUMERATE = re.compile(r"- LF_ENUMERATE \[name = `([^`]*)`, value = (-?\d+)")
_TYPEDEF = re.compile(r"^\s*type = 0x[0-9A-Fa-f]+ \((.*)\)\s*$")


def _parse_pdb(text: str, image=None) -> DebugInfo:
    sections = _pdb_sections(text)
    types = _pdb_type_records(text)
    records: list[dict] = []
    cur: dict | None = None
    for raw in text.splitlines():
        line = raw.rstrip("\n")
        m = _PDB_SYM.match(line)
        if m:
            cur = {"kind": m.group(1), "name": m.group(2), "lines": []}
            records.append(cur)
            continue
        if cur is not None:
            if line.startswith((" ", "\t")):
                if line.strip():
                    cur["lines"].append(line)
                continue
            if not line.strip():
                continue
            cur = None

    syms: dict[tuple[int, str], DebugFunction] = {}
    public: dict[int, str] = {}
    img_base = int(getattr(image, "image_base", 0) or 0)
    for rec in records:
        kind = rec["kind"]
        if kind not in ("S_GPROC32", "S_LPROC32", "S_GPROC32_ID", "S_LPROC32_ID", "S_THUNK32",
                        "S_LTHUNK32", "S_PUB32"):
            continue
        addr = size = 0
        signature = ""
        flags = ""
        for line in rec["lines"]:
            if "exception handler" not in line and (m := _PDB_ADDR.search(line)):
                sec, off = int(m.group(1)), int(m.group(2), 16)
                va = sections.get(sec, (0, 0))[0]
                if not va and image is not None and 0 < sec <= len(getattr(image, "sections", [])):
                    va = image.sections[sec - 1].va
                addr = img_base + va + off if va else off
            if (m := _PDB_SIZE.search(line)):
                size = int(m.group(1))
            if (m := _PDB_TYPE.search(line)):
                signature = _signature(rec["name"], m.group(1))
            if "flags =" in line:
                flags = line.split("flags =", 1)[1].strip()
        if not addr or not rec["name"]:
            continue
        is_func = kind != "S_PUB32" or "function" in flags
        if is_func:
            old = syms.get((addr, rec["name"]))
            if old is None or size > old.size:
                syms[(addr, rec["name"])] = DebugFunction(rec["name"], addr, size, signature)
            public.setdefault(addr, rec["name"])
        else:
            public.setdefault(addr, rec["name"])

    if not syms:  # a PDB with publics but no procedure records
        for addr, name in public.items():
            syms[(addr, name)] = DebugFunction(name, addr)
    header = _pdb_header(types, _pdb_type_names(text), list(syms.values()))
    symbols = [Symbol(f.name, f.address, f.size, "func") for f in syms.values()]
    for addr, name in public.items():
        if not any(f.address == addr for f in syms.values()):
            symbols.append(Symbol(name, addr, 0, "data"))
    return DebugInfo("PDB", symbols=symbols, functions=list(syms.values()),
                     types=_pdb_types(types), header=header)


def _pdb_sections(text: str) -> dict[int, tuple[int, int]]:
    """Section number -> (RVA, virtual size), from llvm-pdbutil's section-header dump."""
    out: dict[int, tuple[int, int]] = {}
    section = 0
    for line in text.splitlines():
        if (m := _SECTION.match(line)):
            section = int(m.group(1))
            out.setdefault(section, (0, 0))
        elif section:
            if (m := _PDB_VA.match(line)):
                _va, size = out[section]
                out[section] = (int(m.group(1), 16), size)
            elif (m := _PDB_VSIZE.match(line)):
                va, _size = out[section]
                out[section] = (va, int(m.group(1), 16))
    return out


def _pdb_type_records(text: str) -> dict[int, dict]:
    """Type index -> {kind, name, lines}. Nested field lines belong to the last type record."""
    out: dict[int, dict] = {}
    cur: dict | None = None
    for line in text.splitlines():
        m = _TYPE.match(line)
        if m:
            cur = {"kind": m.group(2), "name": m.group(3) or "", "lines": []}
            out[int(m.group(1), 16)] = cur
            continue
        if cur is not None:
            if line.startswith(("  ", "\t")):
                if line.strip():
                    cur["lines"].append(line)
                continue
            if line.strip():
                cur = None
    return out

def _signature(name: str, type_text: str) -> str:
    """`0x1001 (int (int, int))` plus a name -> `int add(int, int);`."""
    if not type_text:
        return ""
    type_text = re.sub(r"^0x[0-9A-Fa-f]+\s*", "", type_text).strip()
    if type_text.startswith("(") and type_text.endswith(")"):
        type_text = type_text[1:-1].strip()
    m = re.match(r"^(.*?)\s*\((.*)\)$", type_text)
    if not m:
        return f"{type_text} {name};"
    return f"{m.group(1).strip()} {name}({m.group(2).strip()});"


def _trim_types(body: str) -> str:
    """Keep a header that is too large at a declaration boundary, never in the middle of a struct."""
    if len(body) <= MAX_HEADER:
        return body
    cut = body[:MAX_HEADER]
    end = max(cut.rfind(";\n"), cut.rfind("}\n"))
    return cut[:end + 1] + "\n/* … truncated */"


def _field_decl(ftype: str, name: str) -> str:
    if ftype.endswith("]") and "[" in ftype:
        base, dim = ftype.split("[", 1)
        return f"{base.rstrip()} {name}[{dim};"
    return f"{ftype} {name};"


def _pdb_type_names(text: str) -> dict[int, str]:
    """Type index -> display name for the simple types llvm-pdbutil prints in parentheses."""
    return {int(m.group(1), 16): m.group(2).strip()
            for m in re.finditer(r"0x([0-9A-Fa-f]+) \(([^)]*)\)", text)}


def _pdb_type_name(index: int, types: dict[int, dict], names: dict[int, str], seen=None) -> str:
    if index in names:
        return names[index]
    seen = seen or set()
    if index in seen or index not in types:
        return "void"
    rec = types[index]
    kind, lines = rec["kind"], rec["lines"]
    if kind in ("LF_STRUCTURE", "LF_CLASS", "LF_INTERFACE", "LF_UNION", "LF_ENUM", "LF_TYPEDEF") and rec["name"]:
        return ("union " if kind == "LF_UNION" else "enum " if kind == "LF_ENUM" else
                "struct " if kind != "LF_TYPEDEF" else "") + rec["name"]
    if kind == "LF_POINTER":
        ref = next((int(m.group(1), 16) for line in lines if (m := re.search(r"referent = 0x([0-9A-Fa-f]+)", line))), 0)
        return _pdb_type_name(ref, types, names, seen | {index}) + " *"
    if kind == "LF_MODIFIER":
        ref = next((int(m.group(1), 16) for line in lines if (m := re.search(r"referent = 0x([0-9A-Fa-f]+)", line))), 0)
        mods = next((line.split("modifiers =", 1)[1].strip() for line in lines if "modifiers =" in line), "")
        base = _pdb_type_name(ref, types, names, seen | {index})
        return (mods + " " + base).strip() if mods else base
    if kind == "LF_ARRAY":
        elem = next((int(m.group(1), 16) for line in lines
                     if (m := re.search(r"element type: 0x([0-9A-Fa-f]+)", line))), 0)
        size = next((int(m.group(1)) for line in lines if (m := re.search(r"size: (\d+)", line))), 0)
        base = _pdb_type_name(elem, types, names, seen | {index})
        known = {"char": 1, "signed char": 1, "unsigned char": 1, "short": 2, "unsigned short": 2,
                 "int": 4, "unsigned int": 4, "long": 4, "unsigned long": 4}
        count = size // known[base] if base in known and size else 0
        return f"{base}[{count or ''}]"
    return "void"


_BASE_WORDS = {"void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const",
               "volatile", "struct", "union", "enum", "__int8", "__int16", "__int32", "__int64", "bool", "wchar_t"}


def _prototypes(functions, known=()) -> list[str]:
    """Only signatures whose type names are known; a missing type would make the whole header fail to compile."""
    out = []
    known = {str(x) for x in known}
    for f in functions:
        if not f.signature or not IDENT.match(f.name):
            continue
        line = f.signature.strip()
        names = set(re.findall(r"[A-Za-z_]\w*", line)) - {f.name} - _BASE_WORDS
        if any(n not in known for n in names):
            continue
        if not line.endswith(";"):
            line += ";"
        out.append(line)
    return list(dict.fromkeys(out))


def _pdb_header(types: dict[int, dict], names: dict[int, str] | None = None, functions=()) -> str:
    names = names if names is not None else {}
    decls: list[str] = []
    forward: list[str] = []
    typedefs: list[str] = []
    for rec in types.values():
        if rec["kind"] in ("LF_STRUCTURE", "LF_CLASS", "LF_INTERFACE", "LF_UNION") and IDENT.match(rec["name"] or ""):
            word = "union" if rec["kind"] == "LF_UNION" else "struct"
            forward.append(f"{word} {rec['name']};")
            typedefs.append(f"typedef {word} {rec['name']} {rec['name']};")
    seen: set[str] = set()
    for rec in types.values():
        kind, name, lines = rec["kind"], rec["name"], rec["lines"]
        if not name or name in seen or not IDENT.match(name):
            continue
        if kind in ("LF_STRUCTURE", "LF_CLASS", "LF_INTERFACE", "LF_UNION"):
            sizeof = 0
            for line in lines:
                if "sizeof" in line:
                    with contextlib.suppress(AttributeError, ValueError):
                        sizeof = int(re.search(r"sizeof (\d+)", line).group(1))
            fields = []
            field_id = next((int(m.group(1), 16) for line in lines if (m := re.search(r"field list: 0x([0-9A-Fa-f]+)", line))), None)
            field_lines = types[field_id]["lines"] if field_id in types else lines
            for line in field_lines:
                m = _MEMBER.search(line)
                if m:
                    ftype = m.group(3) or _pdb_type_name(int(m.group(2), 16), types, names)
                    fields.append("    " + _field_decl(ftype, m.group(1)))
            word = "union" if kind == "LF_UNION" else "struct"
            if fields:
                decls.append(f"{word} {name} {{\n" + "\n".join(fields) + "\n};")
                seen.add(name)
            elif sizeof:
                decls.append(f"{word} {name} {{ unsigned char _[{sizeof}]; }};")
                seen.add(name)
        elif kind == "LF_ENUM":
            vals = [f"    {m.group(1)} = {m.group(2)}," for line in lines if (m := _ENUMERATE.search(line))]
            if vals:
                decls.append(f"enum {name} {{\n" + "\n".join(vals) + "\n};")
                seen.add(name)
        elif kind == "LF_TYPEDEF":
            for line in lines:
                m = _TYPEDEF.match(line)
                if m:
                    decls.append(f"typedef {m.group(1)} {name};")
                    seen.add(name)
                    break
    if not decls:
        return ""
    body = _trim_types("\n".join(dict.fromkeys(forward + decls + typedefs)))
    protos = _prototypes(functions, {rec.get("name", "") for rec in types.values()} | set(names.values()))
    if protos:
        body += ("\n\n" if body else "") + "/* Function prototypes from the PDB. */\n" + "\n".join(protos)
    return f"/* Types from the program's PDB. */\n{body}\n" if body else ""


def _pdb_types(types: dict[int, dict]) -> list[DebugType]:
    out: dict[str, DebugType] = {}
    for rec in types.values():
        name = rec["name"]
        if not name or len(out) >= MAX_TYPES:
            continue
        kind = {"LF_STRUCTURE": "struct", "LF_CLASS": "struct", "LF_INTERFACE": "struct",
                "LF_UNION": "union", "LF_ENUM": "enum", "LF_TYPEDEF": "typedef"}.get(rec["kind"])
        if kind:
            out.setdefault(name, DebugType(name, kind))
    return list(out.values())


# ------------------------------------------------------------------ DWARF

def _has_debug_info(data: bytes) -> bool:
    try:
        from elftools.elf.elffile import ELFFile
        elf = ELFFile(BytesIO(data))
        return elf.get_section_by_name(".debug_info") is not None
    except Exception:  # noqa: BLE001
        return False


def _read_dwarf(data: bytes, source: str, image=None) -> DebugInfo:
    try:
        from elftools.elf.elffile import ELFFile
        elf = ELFFile(BytesIO(data))
        dwarf = elf.get_dwarf_info()
    except Exception as e:
        raise DebugInfoError(f"couldn't read DWARF: {e}") from e
    functions: dict[tuple[int, str], DebugFunction] = {}
    symbols: dict[tuple[int, str], Symbol] = {}
    types: dict[str, DebugType] = {}
    die_cache: dict[int, object] = {}
    for cu in dwarf.iter_CUs():
        try:
            for die in cu.iter_DIEs():
                die_cache[die.offset] = die
                tag = die.tag
                if tag == "DW_TAG_subprogram":
                    low = _attr(die, "DW_AT_low_pc")
                    if not isinstance(low, int) or not low:
                        continue
                    name = _text(_attr(die, "DW_AT_name") or _attr(die, "DW_AT_linkage_name"))
                    if not name:
                        continue
                    high = _attr(die, "DW_AT_high_pc")
                    size = _high_size(die, low, high)
                    sig = _dwarf_signature(die, dwarf, cu, die_cache)
                    functions.setdefault((low, name), DebugFunction(name, low, size, sig))
                    symbols.setdefault((low, name), Symbol(name, low, size, "func"))
                elif tag == "DW_TAG_variable":
                    low = _attr(die, "DW_AT_low_pc")
                    name = _text(_attr(die, "DW_AT_name"))
                    if isinstance(low, int) and low and name:
                        symbols.setdefault((low, name), Symbol(name, low, 0, "data"))
                elif tag in ("DW_TAG_structure_type", "DW_TAG_union_type", "DW_TAG_class_type"):
                    _dwarf_struct(die, dwarf, cu, die_cache, types)
                elif tag == "DW_TAG_enumeration_type":
                    _dwarf_enum(die, dwarf, cu, die_cache, types)
                elif tag == "DW_TAG_typedef":
                    _dwarf_typedef(die, dwarf, cu, die_cache, types)
        except Exception:  # noqa: BLE001
            continue
    header = _dwarf_header(types, list(functions.values()))
    return DebugInfo(source, symbols=list(symbols.values()), functions=list(functions.values()),
                     types=list(types.values()), header=header)


def _attr(die, name: str):
    attr = die.attributes.get(name)
    return attr.value if attr is not None else None


def _text(value) -> str:
    """DWARF strings are bytes in pyelftools; C names are text everywhere else."""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value) if value is not None else ""


def _high_size(die, low: int, high) -> int:
    if not isinstance(high, int):
        return 0
    attr = die.attributes.get("DW_AT_high_pc")
    if attr is not None and attr.form != "DW_FORM_addr":
        return high
    return max(0, high - low)


def _dwarf_type(die, dwarf, cu, cache: dict[int, object], seen: set[int] | None = None) -> str:
    seen = seen or set()
    if die is None or die.offset in seen:
        return "void"
    seen = seen | {die.offset}
    tag = die.tag
    name = _attr(die, "DW_AT_name") or _attr(die, "DW_AT_linkage_name")
    if tag == "DW_TAG_base_type":
        return _text(name) or "int"
    if tag == "DW_TAG_typedef":
        return _text(name) or "int"
    if tag in ("DW_TAG_structure_type", "DW_TAG_union_type", "DW_TAG_class_type"):
        prefix = "union" if tag == "DW_TAG_union_type" else "struct"
        return f"{prefix} {_text(name)}" if name else "void"
    if tag == "DW_TAG_enumeration_type":
        return f"enum {_text(name)}" if name else "int"
    if tag == "DW_TAG_pointer_type":
        target = _dwarf_ref(die, dwarf, cu, cache)
        base = _dwarf_type(target, dwarf, cu, cache, seen)
        return f"{base} *"
    if tag == "DW_TAG_const_type":
        return "const " + _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache, seen)
    if tag == "DW_TAG_volatile_type":
        return "volatile " + _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache, seen)
    if tag == "DW_TAG_array_type":
        elem = _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache, seen)
        count = ""
        try:
            for child in die.iter_children():
                if child.tag == "DW_TAG_subrange_type":
                    n = _attr(child, "DW_AT_count")
                    upper = _attr(child, "DW_AT_upper_bound")
                    if isinstance(n, int):
                        count = str(n)
                    elif isinstance(upper, int):
                        count = str(upper + 1)
                    break
        except Exception:  # noqa: BLE001
            pass
        return f"{elem}[{count}]"
    if tag == "DW_TAG_subroutine_type":
        ret = _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache, seen)
        return f"{ret} (*)()"
    if name:
        return _text(name)
    return "void"


def _dwarf_ref(die, dwarf, cu, cache: dict[int, object]):
    ref = _attr(die, "DW_AT_type")
    if not isinstance(ref, int):
        return None
    if ref in cache:
        return cache[ref]
    try:
        found = dwarf.get_DIE_from_refaddr(ref, cu)
        cache[ref] = found
        return found
    except Exception:  # noqa: BLE001
        return None


def _dwarf_signature(die, dwarf, cu, cache: dict[int, object]) -> str:
    name = _text(_attr(die, "DW_AT_name") or _attr(die, "DW_AT_linkage_name"))
    if not name:
        return ""
    ret = _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache)
    args: list[str] = []
    try:
        for child in die.iter_children():
            if child.tag == "DW_TAG_formal_parameter":
                args.append(_dwarf_type(_dwarf_ref(child, dwarf, cu, cache), dwarf, cu, cache))
            elif child.tag == "DW_TAG_unspecified_parameters":
                args.append("...")
    except Exception:  # noqa: BLE001
        pass
    return f"{ret} {name}({', '.join(args)})"


def _dwarf_struct(die, dwarf, cu, cache: dict[int, object], types: dict[str, DebugType]) -> None:
    name = _text(_attr(die, "DW_AT_name"))
    if not name or not IDENT.match(name):
        return
    fields = []
    try:
        for child in die.iter_children():
            if child.tag != "DW_TAG_member":
                continue
            fname = _text(_attr(child, "DW_AT_name"))
            if not fname:
                continue
            ftype = _dwarf_type(_dwarf_ref(child, dwarf, cu, cache), dwarf, cu, cache)
            fields.append("    " + _field_decl(ftype, fname))
    except Exception:  # noqa: BLE001
        return
    word = "union" if die.tag == "DW_TAG_union_type" else "struct"
    if fields:
        decl = f"{word} {name} {{\n" + "\n".join(fields) + "\n};"
        types.setdefault(name, DebugType(name, word, 0, decl))


def _dwarf_enum(die, dwarf, cu, cache: dict[int, object], types: dict[str, DebugType]) -> None:
    name = _text(_attr(die, "DW_AT_name"))
    if not name or not IDENT.match(name):
        return
    vals = []
    try:
        for child in die.iter_children():
            if child.tag == "DW_TAG_enumerator":
                ename = _text(_attr(child, "DW_AT_name"))
                value = _attr(child, "DW_AT_const_value")
                if ename is not None and value is not None:
                    vals.append(f"    {ename} = {value},")
    except Exception:  # noqa: BLE001
        return
    if vals:
        types.setdefault(name, DebugType(name, "enum", 0, f"enum {name} {{\n" + "\n".join(vals) + "\n};"))


def _dwarf_typedef(die, dwarf, cu, cache: dict[int, object], types: dict[str, DebugType]) -> None:
    name = _text(_attr(die, "DW_AT_name"))
    if not name or not IDENT.match(name):
        return
    target = _dwarf_type(_dwarf_ref(die, dwarf, cu, cache), dwarf, cu, cache)
    if target and target != "void":
        types.setdefault(name, DebugType(name, "typedef", 0, f"typedef {target} {name};"))


def _dwarf_header(types: dict[str, DebugType], functions=()) -> str:
    forward = [f"{t.kind} {t.name};" for t in types.values() if t.kind in ("struct", "union")]
    typedef_names = {t.name for t in types.values() if t.kind == "typedef"}
    typedefs = [f"typedef {t.kind} {t.name} {t.name};" for t in types.values()
                if t.kind in ("struct", "union") and t.name not in typedef_names]
    decls = [t.declaration for t in types.values() if t.declaration]
    body = _trim_types("\n".join(dict.fromkeys(forward + decls + typedefs)))
    protos = _prototypes(functions, set(types))
    if protos:
        body += ("\n\n" if body else "") + "/* Function prototypes from the DWARF. */\n" + "\n".join(protos)
    return f"/* Types from the program's DWARF. */\n{body}\n" if body else ""
