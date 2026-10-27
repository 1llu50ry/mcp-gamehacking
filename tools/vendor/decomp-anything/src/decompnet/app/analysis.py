"""Analysis projects: REA targets that are not matching-decompilation games.

A matching project asks "what C compiles to these bytes?". An analysis project asks a wider question, and its work
items are procedures, files inside an archive, or tasks the user adds: each agent claims one, reads it through
REA or directly from the archive, and records what it learned. There is no compiler and no score; a work item is
done when an agent writes its findings.

The project reuses the same tables and dashboard as a game: functions are claims, notes are notes, and
status "matched" means "analyzed" for this kind of project.
"""

from __future__ import annotations

import hashlib
import posixpath
import re
import tarfile
import zipfile
from pathlib import Path
from typing import Any


def number(value: Any) -> int | None:
    """An address from REA: 0x-prefixed text, decimal text or an int."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    if not text or text.upper().startswith("EXTERNAL"):
        return None
    try:
        return int(text, 0)
    except ValueError:
        try:
            return int(text, 10)
        except ValueError:
            return None


def segment_at(address: int, segments: list[dict]) -> str:
    for seg in segments or ():
        start, end = number(seg.get("start")), number(seg.get("end"))
        if start is not None and end is not None and start <= address < end:
            return str(seg.get("name") or "")
    return ""


def procedures(value: Any, segments: list[dict] | None = None) -> list[dict]:
    """REA's list_procedures as work items: [{name, address, size, unit}], internal procedures only."""
    rows = value if isinstance(value, list) else (
        (value or {}).get("procedures") or (value or {}).get("result") or [])
    found: dict[int, dict] = {}
    for row in rows:
        if isinstance(row, dict):
            address = number(row.get("address"))
            name = row.get("value") or row.get("name") or row.get("label")
            proc = row.get("procedure") if isinstance(row.get("procedure"), dict) else {}
            if proc.get("external") or row.get("external"):
                continue
        else:
            address, name, proc = number(row), row, {}
        if address is None:
            continue
        name = str(name or f"sub_{address:X}")
        found.setdefault(address, {"name": name, "address": address, "unit": segment_at(address, segments or [])})
    items = sorted(found.values(), key=lambda x: x["address"])
    for i, item in enumerate(items):
        nxt = items[i + 1]["address"] if i + 1 < len(items) else item["address"]
        size = nxt - item["address"]
        item["size"] = size if 0 < size < (1 << 20) else 0
    return items


def opened_target(value: Any, path: str) -> dict:
    """The target half of REA's open_binary answer (or a best effort for other inspector tools)."""
    value = value or {}
    if isinstance(value, dict) and isinstance(value.get("result"), dict):
        value = value["result"]
    if not isinstance(value, dict):
        value = {}
    return {
        "path": str(value.get("path") or path),
        "format": str(value.get("format") or ""),
        "architecture": str(value.get("architecture") or value.get("arch") or ""),
        "kind": str(value.get("kind") or ""),
        "sha256": str(value.get("sha256") or ""),
        "size": value.get("size") or value.get("byte_size") or None,
    }


def overview_counts(value: Any) -> dict:
    value = value if isinstance(value, dict) else {}
    return {
        "procedures": value.get("procedure_count"),
        "strings": value.get("string_count"),
        "segments": value.get("segment_count"),
    }


def clean_segments(value: Any) -> list[dict]:
    rows = value if isinstance(value, list) else (value or {}).get("segments") or []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append({k: row.get(k) for k in ("name", "start", "end", "executable", "writable", "initialized")
                    if k in row})
    return out[:200]


def pretty(value: Any, limit: int = 12000) -> str:
    """A REA answer for an agent: strings as they are, everything else as JSON, bounded."""
    if isinstance(value, str):
        text = value
    else:
        import json

        text = json.dumps(value, indent=1, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + f"\n… ({len(text) - limit} more characters)"


def dossier(value: Any) -> str:
    """A readable function dossier from analyze_function: signature, pseudocode, assembly, calls, strings."""
    if not isinstance(value, dict):
        return pretty(value)
    proc = value.get("procedure") if isinstance(value.get("procedure"), dict) else {}
    out: list[str] = []
    sig = proc.get("signature") or proc.get("name")
    if sig:
        out.append(f"signature: {sig}")
    if proc.get("body"):
        body = proc["body"]
        if isinstance(body, dict) and body.get("total_bytes") is not None:
            out.append(f"body: {body['total_bytes']} bytes")
    code = value.get("pseudocode") or value.get("decompiled") or proc.get("pseudocode")
    if isinstance(code, str) and code.strip():
        out += ["", "REA pseudocode (a draft, not the original source):", "```c", code.strip(), "```"]
    asm = value.get("assembly") or proc.get("assembly")
    if isinstance(asm, list):
        asm = "\n".join(str(x) for x in asm)
    if isinstance(asm, str) and asm.strip():
        out += ["", "assembly:", "```asm", asm.strip(), "```"]
    for key, label in (("callers", "callers"), ("callees", "callees"), ("referenced_strings", "strings"),
                       ("referenced_names", "names")):
        rows = value.get(key)
        if rows:
            out += ["", f"{label}: " + summarize(rows)]
    for key, label in (("incoming_references", "incoming references"),
                       ("outgoing_references", "outgoing references")):
        rows = value.get(key)
        if rows:
            out += ["", f"{label}: " + summarize(rows)]
    if not out:
        return pretty(value)
    text = "\n".join(out)
    return text if len(text) <= 20000 else text[:20000] + f"\n… ({len(text) - 20000} more characters; use rea_tool for a narrower view)"


def batch_view(value: Any, limit: int = 4, max_code: int = 6000) -> dict:
    """batch_decompile's answer as functions a brief or the project page can show.

    A success carries its pseudocode, a failure the reason, and `more` counts the results this view left out.
    """
    items = value.get("items") if isinstance(value, dict) else None
    if not isinstance(items, list):
        return {"items": [], "more": 0}
    out: list[dict] = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        proc = item.get("procedure") if isinstance(item.get("procedure"), dict) else {}
        address = str(proc.get("address") or item.get("address") or "")
        name = str(proc.get("name") or "")
        label = name or address or "function"
        if item.get("status") != "ok":
            err = item.get("error") or {}
            message = str(err.get("message") if isinstance(err, dict) else err or "").strip()
            out.append({"name": label, "address": address, "error": message})
            continue
        code = str(item.get("pseudocode") or "").strip()
        if not code:
            continue
        if len(code) > max_code:
            code = code[:max_code] + "\n… (truncated)"
        out.append({"name": label, "address": address, "code": code})
    return {"items": out, "more": max(0, len(items) - limit)}


def batch_text(items: Any, more: int = 0, budget: int = 20000) -> str:
    """Normalized batch items (batch_view) as the pseudocode blocks a claim brief shows."""
    rows = [row for row in items if isinstance(row, dict)] if isinstance(items, list) else []
    if not rows:
        return "REA decompiled nothing for these functions."
    out: list[str] = []
    used = 0
    noted = False
    for index, item in enumerate(rows):
        label = str(item.get("name") or item.get("address") or "function")
        address = str(item.get("address") or "")
        if item.get("error") is not None:
            message = str(item.get("error") or "").strip()
            out.append(f"### {label}" + (f" ({address})" if address and address != label else "")
                       + ": REA couldn't decompile it" + (f": {message}" if message else ""))
            continue
        code = str(item.get("code") or "").strip()
        if not code:
            continue
        block = [f"### {label}" + (f" at {address}" if address and address != label else ""), "```c", code, "```"]
        size = sum(len(line) for line in block)
        if out and used + size > budget:
            remaining = more + len(rows) - index
            if remaining:
                out.append(f"({remaining} more functions came with this batch; ask REA with batch_decompile "
                           "for them.)")
            noted = True
            break
        out += block
        used += size
    if more and not noted:
        out.append(f"({more} more functions came with this batch; ask REA with batch_decompile for them.)")
    return "\n".join(out) if out else "REA decompiled nothing for these functions."


def batch_dossier(value: Any, limit: int = 4, budget: int = 20000) -> str:
    """Several functions from batch_decompile as pseudocode blocks: a survey's or task's starting point.

    Per-item failures stay visible (REA decompiles what it can and reports the rest), and the whole answer is
    bounded so a claim brief stays readable.
    """
    view = batch_view(value, limit)
    return batch_text(view["items"], view["more"], budget)


def summarize(rows: Any, limit: int = 30) -> str:
    if not isinstance(rows, list):
        return str(rows)[:1000]
    out = []
    for row in rows[:limit]:
        if isinstance(row, dict):
            addr = row.get("address") or row.get("value") or row.get("name")
            name = row.get("name") or row.get("value")
            target = row.get("target_procedure") or row.get("source_procedure")
            if isinstance(target, dict):
                name = target.get("name") or name
                addr = target.get("address") or addr
            out.append(f"{name or '?'}" + (f" @ {addr}" if addr and str(addr) != str(name) else ""))
        else:
            out.append(str(row))
    more = f" … {len(rows) - limit} more" if len(rows) > limit else ""
    return ", ".join(out) + more


# Archives whose contents can become work items. Android packages use the Android inspector, not this table.
ARCHIVE_SUFFIXES = (".zip", ".jar", ".whl", ".ipa", ".tar", ".tgz", ".tar.gz")
# Resource limits for a hostile or accidental archive. They are deliberately generous for user-owned targets.
MAX_ARCHIVE_INPUT = 2 * 1024 * 1024 * 1024
MAX_INVENTORY_ENTRIES = 20_000
MAX_INVENTORY_BYTES = 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1000
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_NESTING = 3
MAX_SOURCE_BYTES = 4 * 1024 * 1024        # one source entry read back out of an archive
MAX_RECOVERED_BYTES = 64 * 1024 * 1024    # all source entries recovered from one archive
INSPECT_TIMEOUT = 300


def is_archive(path: str | Path) -> bool:
    lower = str(path).lower()
    return lower.endswith(ARCHIVE_SUFFIXES)


def artifact_inventory(value: Any) -> dict | None:
    """The inventory inside inspect_artifact's normalized result (it lives in a substep's evidence)."""
    seen: set[int] = set()

    def find(node: Any, depth: int) -> dict | None:
        if depth > 8 or not isinstance(node, (dict, list)) or id(node) in seen:
            return None
        seen.add(id(node))
        if isinstance(node, dict) and isinstance(node.get("occurrences"), list) and isinstance(node.get("nodes"), list):
            return node
        for child in (node.values() if isinstance(node, dict) else node):
            if isinstance(child, (dict, list)):
                found = find(child, depth + 1)
                if found is not None:
                    return found
        return None

    return find(value, 0)


def validate_inventory(inventory: dict) -> None:
    """Fail closed on entry-count, total-size or compression-ratio bombs before work items are written."""
    occurrences = [o for o in inventory.get("occurrences") or [] if isinstance(o, dict)]
    if len(occurrences) > MAX_INVENTORY_ENTRIES:
        raise ValueError(f"archive has {len(occurrences):,} entries; the limit is {MAX_INVENTORY_ENTRIES:,}. "
                         "Extract the part you need and analyze that instead.")
    nodes = {n.get("artifact_id"): n for n in inventory.get("nodes") or [] if isinstance(n, dict)}
    total = 0
    for occ in occurrences:
        if occ.get("entry_kind") != "file":
            continue
        node = nodes.get(occ.get("artifact_id")) or {}
        size = int(occ.get("declared_size") or node.get("size") or 0)
        total += size
        compressed = occ.get("compressed_size")
        if compressed and int(compressed) > 0 and size > int(compressed) * MAX_COMPRESSION_RATIO:
            raise ValueError(f"{occ.get('logical_path') or 'an entry'} expands {size:,} bytes from {compressed} "
                             f"compressed bytes; that compression ratio is refused")
        if total > MAX_INVENTORY_BYTES:
            raise ValueError(f"archive files total more than {MAX_INVENTORY_BYTES // (1024 * 1024)} MiB when "
                             "uncompressed; analyze a smaller part")


def artifact_entries(inventory: dict) -> list[dict]:
    """Regular files in an artifact inventory as work items, with the inventory facts the agent needs."""
    nodes = {n.get("artifact_id"): n for n in inventory.get("nodes") or [] if isinstance(n, dict)}
    out: list[dict] = []
    for occ in inventory.get("occurrences") or []:
        if not isinstance(occ, dict) or occ.get("entry_kind") != "file":
            continue
        path = str(occ.get("logical_path") or "").strip()
        if not path or path == ".":
            continue
        node = nodes.get(occ.get("artifact_id")) or {}
        info = classify_entry(path)
        out.append({
            "name": path, "kind": "artifact-entry", "address": 0,
            "size": int(occ.get("declared_size") or node.get("size") or 0),
            "unit": posixpath.dirname(path),
            "path": path, "sha256": str(node.get("sha256") or ""),
            "entry_kind": str(occ.get("entry_kind") or "file"),
            "artifact_kind": str(occ.get("artifact_kind") or ""),
            "artifact_format": str(occ.get("artifact_format") or ""),
            "compressed_size": occ.get("compressed_size"),
            "executable": bool(occ.get("executable")), "encrypted": bool(occ.get("encrypted")),
            **info,
        })
    out.sort(key=lambda item: item["path"])
    return out


def read_archive_entry(path: str | Path, name: str, offset: int = 0, length: int = 4096) -> bytes | None:
    """Read at most `length` bytes of one regular entry, without extracting the archive."""
    offset, length = max(0, int(offset)), max(1, min(int(length), 65536))
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo(name)
                if info.is_dir() or info.flag_bits & 0x1:
                    return None
                with archive.open(info) as handle:
                    handle.seek(offset)
                    return handle.read(length)
        if tarfile.is_tarfile(path):
            with tarfile.open(path) as archive:
                member = archive.getmember(name)
                if not member.isfile():
                    return b""
                handle = archive.extractfile(member)
                if handle is None:
                    return None
                handle.seek(offset)
                return handle.read(length)
    except (OSError, KeyError, tarfile.TarError, zipfile.BadZipFile):
        return None
    return None




# Text source inside an archive: its code shipped as text, so it comes back exactly (verified, not reconstructed).
SOURCE_EXTS = {
    ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hpp": "C++", ".hh": "C++",
    ".hxx": "C++", ".cs": "C#", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".groovy": "Groovy",
    ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".vue": "Vue", ".svelte": "Svelte",
    ".py": "Python", ".rb": "Ruby", ".php": "PHP", ".lua": "Lua", ".pl": "Perl", ".pm": "Perl",
    ".go": "Go", ".rs": "Rust", ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C++",
    ".dart": "Dart", ".scala": "Scala", ".r": "R", ".jl": "Julia",
    ".html": "HTML", ".htm": "HTML", ".xhtml": "HTML", ".css": "CSS", ".scss": "SCSS", ".less": "Less",
    ".s": "Assembly", ".asm": "Assembly", ".inc": "Assembly",
    ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".ps1": "PowerShell", ".bat": "Batch", ".cmd": "Batch",
    ".sql": "SQL", ".glsl": "GLSL", ".vert": "GLSL", ".frag": "GLSL", ".hlsl": "HLSL", ".wgsl": "WGSL",
}
# Code that did not ship as text: the source has to be reconstructed from the artifact.
COMPILED_EXTS = {
    ".pyc": "Python bytecode", ".pyo": "Python bytecode", ".class": "Java bytecode",
    ".luac": "Lua bytecode", ".beam": "Erlang bytecode", ".elc": "Emacs Lisp bytecode",
}
# What a reconstructed compiled entry is written as (the source file, not the bytecode).
COMPILED_SOURCE_EXTS = {".pyc": ".py", ".pyo": ".py", ".class": ".java", ".luac": ".lua",
                        ".beam": ".erl", ".elc": ".el"}


# What an archive entry is, for the Contents tree and for choosing how to open it as a child target.
_ENTRY_TYPES = {
    ".exe": ("binary", "PE", "open_binary"), ".dll": ("binary", "PE", "open_binary"),
    ".sys": ("binary", "PE", "open_binary"), ".efi": ("binary", "PE", "open_binary"),
    ".elf": ("binary", "ELF", "open_binary"), ".so": ("binary", "ELF", "open_binary"),
    ".o": ("binary", "ELF", "open_binary"), ".ko": ("binary", "ELF", "open_binary"),
    ".bin": ("binary", "binary", "open_binary"), ".rom": ("binary", "binary", "open_binary"),
    ".img": ("binary", "binary", "open_binary"), ".fw": ("binary", "binary", "open_binary"),
    ".apk": ("android", "APK", "inspect_android_package"),
    ".dex": ("android", "DEX", "open_binary"),
    ".js": ("javascript", "JavaScript", "open_binary"),  # REA analyses an app folder or .asar, not one script
    ".asar": ("javascript", "Electron app", "analyze_javascript_application"),
    ".mjs": ("javascript", "JavaScript", "open_binary"),
    ".cjs": ("javascript", "JavaScript", "open_binary"),
    ".wasm": ("wasm", "WASM", "open_binary"),
    ".zip": ("archive", "ZIP", "open_binary"), ".jar": ("archive", "JAR", "open_binary"),
    ".whl": ("archive", "wheel", "open_binary"), ".ipa": ("archive", "IPA", "open_binary"),
    ".tar": ("archive", "TAR", "open_binary"), ".tgz": ("archive", "TAR.GZ", "open_binary"),
    ".json": ("text", "JSON", ""), ".txt": ("text", "text", ""), ".md": ("text", "Markdown", ""),
    ".xml": ("text", "XML", ""), ".csv": ("text", "CSV", ""), ".yaml": ("text", "YAML", ""),
    ".yml": ("text", "YAML", ""), ".ini": ("text", "INI", ""), ".cfg": ("text", "text", ""),
    ".conf": ("text", "text", ""), ".log": ("text", "log", ""), ".html": ("text", "HTML", ""),
    ".css": ("text", "CSS", ""), ".png": ("image", "PNG", ""), ".jpg": ("image", "JPEG", ""),
    ".jpeg": ("image", "JPEG", ""), ".gif": ("image", "GIF", ""), ".svg": ("image", "SVG", ""),
}
_MAGIC_TYPES = (
    (b"\x7fELF", ("binary", "ELF", "open_binary")),
    (b"MZ", ("binary", "PE", "open_binary")),
    (b"PK\x03\x04", ("archive", "ZIP", "open_binary")),
    (b"\x1f\x8b", ("archive", "gzip", "open_binary")),
    (b"\x00asm", ("wasm", "WASM", "open_binary")),
    (b"dex\n", ("android", "DEX", "open_binary")),
)


def classify_entry(path: str, data: bytes | None = None) -> dict:
    """Guess what an archive entry is from its magic first, then its extension. Never executes it."""
    for magic, (kind, fmt, tool) in _MAGIC_TYPES:
        if data and data.startswith(magic):
            return {"entry_type": kind, "entry_format": fmt, "tool": tool, "analyzable": bool(tool)}
    ext = posixpath.splitext(str(path).lower())[1]
    kind, fmt, tool = _ENTRY_TYPES.get(ext, ("unknown", ext.lstrip(".") or "file", ""))
    return {"entry_type": kind, "entry_format": fmt, "tool": tool, "analyzable": bool(tool)}


def recovered_ext(target: dict) -> str:
    """The source extension for code reconstructed from an analyzed target: REA doesn't know the language, so the
    inspector that opened it decides, and C is the honest default for a native binary."""
    target = target or {}
    tool = str(target.get("tool") or "")
    fmt = str(target.get("format") or "").lower()
    kind = str(target.get("kind") or "").lower()
    if tool == "analyze_javascript_application" or "javascript" in fmt:
        return ".js"
    if tool == "inspect_android_package" or "apk" in fmt or "dalvik" in kind or "dex" in kind:
        return ".java"
    if tool == "inspect_managed_artifact" or "managed" in kind or "cil" in kind or "msil" in kind:
        return ".cs"
    return ".c"


def source_language(path: str) -> str | None:
    """The language of a text source entry, or None when the entry isn't source we can hand back as text."""
    return SOURCE_EXTS.get(posixpath.splitext(str(path).lower())[1])


def compiled_language(path: str) -> str | None:
    """The language of a compiled entry whose source didn't ship (bytecode, class files), or None."""
    return COMPILED_EXTS.get(posixpath.splitext(str(path).lower())[1])


def decode_source(data: bytes | None) -> str | None:
    """UTF-8 source text, or None when the bytes are binary (a NUL byte or an undecodable sequence)."""
    if not data or b"\0" in data[:4096]:
        return None
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None
    return text if text.strip() else None


def read_entry_bytes(path: str | Path, name: str, max_bytes: int = MAX_SOURCE_BYTES) -> bytes | None:
    """One regular entry read whole, up to max_bytes; None when it is a directory, encrypted, too large or unreadable."""
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo(name)
                if info.is_dir() or info.flag_bits & 0x1 or info.file_size > max_bytes:
                    return None
                if info.compress_size > 0 and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
                    return None
                with archive.open(info) as handle:
                    data = handle.read(max_bytes + 1)
                return data if len(data) <= max_bytes else None
        if tarfile.is_tarfile(path):
            with tarfile.open(path) as archive:
                member = archive.getmember(name)
                if not member.isfile() or member.size > max_bytes:
                    return None
                handle = archive.extractfile(member)
                if handle is None:
                    return None
                data = handle.read(max_bytes + 1)
                return data if len(data) <= max_bytes else None
    except (OSError, KeyError, tarfile.TarError, zipfile.BadZipFile):
        return None
    return None


def extract_archive_entry(path: str | Path, name: str, dest: str | Path,
                          max_bytes: int = MAX_ENTRY_BYTES) -> tuple[int, str]:
    """Extract exactly one regular entry into a new file, streaming and hashing it. No links, no execution."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    total = 0
    digest = hashlib.sha256()

    def copy(stream) -> None:
        nonlocal total
        with open(tmp, "wb") as out:
            while True:
                chunk = stream.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"that archive entry is larger than {max_bytes // (1024 * 1024)} MiB")
                digest.update(chunk)
                out.write(chunk)

    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo(name)
                if info.is_dir() or info.flag_bits & 0x1:
                    raise ValueError("that entry is a directory or encrypted")
                if info.file_size > max_bytes:
                    raise ValueError(f"that archive entry is larger than {max_bytes // (1024 * 1024)} MiB")
                if info.compress_size > 0 and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
                    raise ValueError("that archive entry's compression ratio is refused")
                with archive.open(info) as stream:
                    copy(stream)
        elif tarfile.is_tarfile(path):
            with tarfile.open(path) as archive:
                member = archive.getmember(name)
                if not member.isfile():
                    raise ValueError("that entry is not a regular file")
                if member.size > max_bytes:
                    raise ValueError(f"that archive entry is larger than {max_bytes // (1024 * 1024)} MiB")
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("that entry couldn't be read")
                copy(stream)
        else:
            raise ValueError("not a readable archive")
        tmp.replace(dest)
        return total, digest.hexdigest()
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def preview_bytes(data: bytes | None, limit: int = 4096) -> str:
    """A bounded text or hex view of an archive entry for the agent's brief."""
    if data is None:
        return "(couldn't read this entry from the archive)"
    if not data:
        return "(empty)"
    sample = data[:limit]
    text = sample.split(b"\0", 1)[0]
    if len(text) >= 3 and all(32 <= c < 127 or c in (9, 10, 13) for c in text):
        return text.decode("ascii", "replace")
    return sample[:512].hex(" ")


# Feature tracing: REA walks a JavaScript or Electron application graph from one literal seed.
FEATURE_SEED_KINDS = ("route", "string", "api", "channel", "module", "native-export", "node-id")
FEATURE_DIRECTIONS = ("both", "outgoing", "incoming")
# Application nodes worth an agent's attention. Containers (a frame, a package) stay in the graph, not the queue.
# One path can appear as several graph roles (an asset, a module, an asar entry, an electron main script).
# The first kind in this list names the work item; the others point at that same item.
FEATURE_WORK_PRIORITY = (
    "javascript-module", "ipc-handler", "ipc-channel", "endpoint", "electron-main", "electron-preload",
    "electron-renderer", "electron-utility", "source-module", "native-addon", "native-export", "worker",
    "service-worker", "storage", "runtime-script-instance", "managed-method", "managed-type", "managed-module",
    "managed-assembly", "javascript-chunk", "javascript-asset", "asar-entry",
)
FEATURE_WORK_KINDS = set(FEATURE_WORK_PRIORITY)
MAX_FEATURES = 40            # per project: a queue people can still read
MAX_FEATURE_NODES = 1500    # stored in the project config and drawn by the page
MAX_FEATURE_EDGES = 3000
MAX_FEATURE_ITEMS = 300     # work items one trace may add


def feature_seed(kind: str, value: str, match: str | None = None, case_sensitive: bool = False) -> dict:
    """One literal seed for trace_application_feature, validated the way REA validates it."""
    kind = str(kind or "").strip()
    if kind not in FEATURE_SEED_KINDS:
        raise ValueError(f"seed kind must be one of {', '.join(FEATURE_SEED_KINDS)}")
    value = str(value or "")
    if not value:
        raise ValueError("give the feature a seed value (a route, string, API, channel, module or node id)")
    match = (str(match).strip() if match else None) or ("contains" if kind == "string" else "exact")
    if match not in ("exact", "contains"):
        raise ValueError("match must be exact or contains")
    if kind == "node-id" and match != "exact":
        raise ValueError("a node-id seed is always exact")
    return {"kind": kind, "value": value, "match": match, "case_sensitive": bool(case_sensitive)}


_DIGEST_PREFIX = re.compile(r"^[0-9a-f]{64}:")
# Labels REA reuses for every node of a kind; the node's own key or path says more.
_GENERIC_LABELS = {"network endpoint", "artifact root", "artifact", "unknown"}
# Namespaces of modules the app imports but does not ship (node's stdlib, electron, npm): nothing to analyze.
_EXTERNAL_NAMESPACES = ("unresolved-", "external-")


def feature_node(node: dict) -> dict | None:
    """One application graph node as the app stores it: a readable name, its path and what it is."""
    if not isinstance(node, dict) or not node.get("node_id"):
        return None
    identity = node.get("identity") if isinstance(node.get("identity"), dict) else {}
    observations = [o for o in node.get("observations") or [] if isinstance(o, dict)]
    label = next((str(o.get("label")) for o in observations if o.get("label")), "")
    path = _DIGEST_PREFIX.sub("", str(identity.get("path") or identity.get("original_source") or ""))
    key = str(identity.get("key") or identity.get("runtime_key") or "")
    kind = str(node.get("kind") or "unknown")
    name = label if label and label.casefold() not in _GENERIC_LABELS else (key or path or label)
    name = name or f"{kind}-{str(node['node_id'])[-8:]}"
    first = observations[0].get("evidence") if observations else {}
    evidence = first if isinstance(first, dict) else {}
    return {
        "node_id": str(node["node_id"]), "kind": kind, "name": name, "label": label, "path": path,
        "namespace": str(identity.get("namespace") or ""),
        "identity": str(identity.get("strategy") or ""),
        "state": str(evidence.get("state") or ""),
        "authority": str(evidence.get("authority") or ""),
        "observations": len(observations),
    }


def feature_external(node: dict) -> bool:
    """A module the app imports but does not ship; a trace reaches it, but there is nothing of the app in it."""
    return str(node.get("namespace") or "").lower().startswith(_EXTERNAL_NAMESPACES)


def feature_graph(trace: dict, max_nodes: int = MAX_FEATURE_NODES,
                  max_edges: int = MAX_FEATURE_EDGES) -> dict:
    """The reachable subgraph of one trace, bounded: nodes with names, and the edges between them."""
    trace = trace if isinstance(trace, dict) else {}
    graph = trace.get("graph") if isinstance(trace.get("graph"), dict) else {}
    nodes: list[dict] = []
    seen: set[str] = set()
    truncated = False
    for raw in graph.get("nodes") or []:
        node = feature_node(raw)
        if node is None or node["node_id"] in seen:
            continue
        if len(nodes) >= max_nodes:
            truncated = True
            break
        seen.add(node["node_id"])
        nodes.append(node)
    edges: list[dict] = []
    edge_seen: set[tuple] = set()
    for raw in graph.get("edges") or []:
        if not isinstance(raw, dict):
            continue
        source, target = str(raw.get("source_node_id") or ""), str(raw.get("target_node_id") or "")
        relation = str(raw.get("relation") or "")
        key = (source, target, relation)
        if source not in seen or target not in seen or key in edge_seen:
            continue
        if len(edges) >= max_edges:
            truncated = True
            break
        edge_seen.add(key)
        edges.append({"source": source, "target": target, "relation": relation})
    return {"nodes": nodes, "edges": edges, "paths": len(trace.get("paths") or []), "truncated": truncated}


def reached_by(edges: list[dict], nodes: list[dict], node_id: str, limit: int = 3) -> str:
    """How a trace reached one node, in words: `source —imports→` (containment included, as REA reports it)."""
    names = {n["node_id"]: (n.get("path") or n.get("label") or n.get("name") or n["node_id"]) for n in nodes}
    rows = [f"{names.get(e['source'], e['source'])} —{e['relation']}→" for e in edges if e["target"] == node_id]
    if not rows:
        return ""
    more = f" (+{len(rows) - limit} more)" if len(rows) > limit else ""
    return ", ".join(rows[:limit]) + more


def feature_seed_text(seed: dict | None) -> str:
    seed = seed or {}
    kind, value = str(seed.get("kind") or ""), str(seed.get("value") or "")
    match = seed.get("match") or "exact"
    return f"{kind} {value!r}" + (f" ({match})" if match != "exact" else "")


_DRIVE_PATH = re.compile(r"^[A-Za-z]:")


def safe_rel_path(path: str) -> str:
    """A relative POSIX path that stays inside the folder it is joined to, or "" when it would climb out.

    Archive entries carry whatever name they were stored with, `../..` and Windows drive letters included: they are
    fine as work items (the archive is read by that exact name) but must never decide where a file is written.
    """
    text = _DRIVE_PATH.sub("", str(path or "").replace("\\", "/")).lstrip("/")
    parts = [p for p in text.split("/") if p not in ("", ".")]
    if not parts or ".." in parts or "\x00" in text:
        return ""
    return "/".join(parts)


def safe_name(name: str, address: int | None = None) -> str:
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    if not name:
        name = f"sub_{address:X}" if address is not None else "task"
    return name[:80]
