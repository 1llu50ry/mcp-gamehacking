"""Read a runtime-coverage trace from a debugger, emulator or profiler.

Accepted shapes (anything else is ignored, so a log can be passed whole):

- one address per line: `0x401000`, `140001000`, `0x401000 5`
- CSV: `address,count` or a header with address/pc/ip/function/name and count/hits
- JSON: [0x401000, ...], [{"address": ..., "count": ...}], or {"name": count, ...}

Addresses may be virtual addresses or RVAs; the project maps both.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

MAX_BYTES = 32 * 1024 * 1024
_HEX = re.compile(r"^(?:0x)?([0-9A-Fa-f]+)$")
_ADDR = re.compile(r"(?:0x)?([0-9A-Fa-f]{4,16})")
_TEXT = re.compile(r"^\s*(?:(?:pc|ip|addr|address)\s*[=:]\s*)?(0x[0-9A-Fa-f]+|[0-9A-Fa-f]{6,16})\b(?:\s*[,;\t ]+\s*(\d+))?")
_NAME = re.compile(r"^\s*([A-Za-z_?][\w@$:.?<>~-]*)\s*(?:[,;\t ]+\s*(\d+))?\s*$")


@dataclass
class TraceHit:
    address: int | None = None
    name: str = ""
    count: int = 1


@dataclass
class TraceFile:
    source: str
    hits: list[TraceHit] = field(default_factory=list)
    skipped: int = 0


def read(path: str | Path) -> TraceFile:
    p = Path(path).expanduser()
    if not p.is_file():
        raise ValueError(f"no trace file at {p}")
    if p.stat().st_size > MAX_BYTES:
        raise ValueError(f"trace file is too large ({p.stat().st_size // (1024 * 1024)} MB); split it or use a coverage file")
    return parse(p.read_text(encoding="utf-8", errors="replace"), p.name)


def parse(text: str, source: str = "trace") -> TraceFile:
    text = text.lstrip("\ufeff")
    if text.lstrip().startswith(("[", "{")):
        try:
            return _json(json.loads(text), source)
        except (ValueError, TypeError):
            pass  # not JSON after all: fall through to the line formats
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith(("#", "//"))]
    if not lines:
        return TraceFile(source)
    first = lines[0].lower()
    if "," in lines[0] and any(k in first for k in ("address", "pc", "ip", "function", "name", "count", "hits")):
        return _csv(text, source)
    return _lines(lines, source)


def _count(value) -> int:
    try:
        n = int(value)
        return n if n > 0 else 1
    except (TypeError, ValueError):
        return 1


def _json(value, source: str) -> TraceFile:
    out = TraceFile(source)
    if isinstance(value, dict):
        # {"hits": [...]} or {"function": count, "0x401000": count}
        if isinstance(value.get("hits"), list):
            return _json(value["hits"], source)
        for key, count in value.items():
            addr = _address(key) if isinstance(key, str) else None
            if addr is not None:
                out.hits.append(TraceHit(addr, "", _count(count)))
            elif isinstance(key, str) and key not in ("name", "count", "hits", "address", "pc", "ip"):
                out.hits.append(TraceHit(None, key, _count(count)))
        return out
    if not isinstance(value, list):
        raise ValueError("trace JSON must be a list or an object")
    for item in value:
        if isinstance(item, int):
            out.hits.append(TraceHit(item))
        elif isinstance(item, str):
            addr = _address(item)
            (out.hits.append(TraceHit(addr)) if addr is not None else out.hits.append(TraceHit(None, item)))
        elif isinstance(item, dict):
            addr = _address(item.get("address", item.get("pc", item.get("ip"))))
            name = item.get("function") or item.get("name") or item.get("symbol") or ""
            count = _count(item.get("count", item.get("hits", item.get("samples", 1))))
            if addr is not None or name:
                out.hits.append(TraceHit(addr, str(name), count))
            else:
                out.skipped += 1
        else:
            out.skipped += 1
    return out


def _csv(text: str, source: str) -> TraceFile:
    out = TraceFile(source)
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return out
    header = [h.strip().lower() for h in rows[0]]
    has_header = any(h in ("address", "pc", "ip", "function", "name", "count", "hits", "samples") for h in header)
    addr_col = next((header.index(h) for h in ("address", "pc", "ip") if h in header), None)
    name_col = next((header.index(h) for h in ("function", "name", "symbol") if h in header), None)
    count_col = next((header.index(h) for h in ("count", "hits", "samples") if h in header), None)
    for row in rows[1 if has_header else 0:]:
        if not row or not any(x.strip() for x in row):
            continue
        if has_header:
            addr = _address(row[addr_col]) if addr_col is not None and addr_col < len(row) else None
            name = row[name_col].strip() if name_col is not None and name_col < len(row) else ""
            count = _count(row[count_col]) if count_col is not None and count_col < len(row) else 1
        else:
            addr = _address(row[0]) if row else None
            name = ""
            count = _count(row[1]) if len(row) > 1 else 1
            if addr is None and row:
                name = row[0].strip()
        if addr is not None or name:
            out.hits.append(TraceHit(addr, name, count))
        else:
            out.skipped += 1
    return out


def _lines(lines: list[str], source: str) -> TraceFile:
    out = TraceFile(source)
    for line in lines:
        m = _TEXT.match(line)
        if m:
            out.hits.append(TraceHit(int(m.group(1), 16), "", _count(m.group(2))))
            continue
        m = _NAME.match(line)
        if m:
            out.hits.append(TraceHit(None, m.group(1), _count(m.group(2))))
        else:
            out.skipped += 1
    return out


def _address(value) -> int | None:
    if isinstance(value, int):
        return value if value >= 0 else None
    if not isinstance(value, str):
        return None
    text = value.strip().replace("_", "")
    if not text:
        return None
    if text.lower().startswith("0x"):
        try:
            return int(text, 16)
        except ValueError:
            return None
    if text.isdigit() and len(text) < 6:
        return int(text)
    # A bare hex word of four characters can be a function name ("add", "dead"); only longer
    # bare addresses are treated as addresses.
    if len(text) >= 6 and _HEX.match(text):
        return int(text, 16)
    return None
