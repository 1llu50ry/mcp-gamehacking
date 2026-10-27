"""Recovered sources for JavaScript and Electron applications.

REA describes an application as a graph; the original files are still on disk, either in the app folder or inside
its `.asar`. When the build shipped source maps, the map's `sourcesContent` is the original source, exactly as the
author wrote it; that is what a project's `recovered/` tree starts with. Modules the graph knows about but no map
covers become reconstruction work items instead.

Nothing here executes the app, follows a symlink out of the target, or writes outside the project's `recovered/`.
"""

from __future__ import annotations

import base64
import json
import posixpath
import re
import struct
from pathlib import Path
from urllib.parse import unquote

SOURCE_EXTS = (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx")
SKIP_DIRS = {"node_modules", ".git"}
MAX_SCAN_FILES = 20_000
MAX_FILE_BYTES = 8 * 1024 * 1024        # one map or script read while looking for maps
MAX_SOURCE_BYTES = 4 * 1024 * 1024      # one recovered file
MAX_RECOVERED_BYTES = 128 * 1024 * 1024 # all recovered files together
MAX_MAPS = 400
MAX_ASAR_HEADER = 64 * 1024 * 1024

# The graph kinds that name a file in the application (and so can become a source work item).
MODULE_KINDS = {"source-module", "javascript-module", "javascript-asset", "electron-main", "electron-preload",
                "electron-renderer", "electron-utility", "asar-entry"}
_DIGEST_PREFIX = re.compile(r"^[0-9a-f]{64}:")
_SCHEME = re.compile(r"^[a-zA-Z][\w+.-]*://[^/]*/")
_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")


class SourceError(ValueError):
    pass


def clean_path(path: str) -> str:
    """A relative POSIX path inside the app, or "": never an absolute path or one that climbs out with `..`."""
    text = str(path or "").strip().replace("\\", "/").lstrip("/")
    text = _DRIVE.sub("", text)
    text = _DIGEST_PREFIX.sub("", text)
    parts = [p for p in text.split("/") if p not in ("", ".")]
    if not parts or ".." in parts or "\x00" in text:
        return ""
    return "/".join(parts)


def source_path(map_path: str, source_root: str, source: str) -> str:
    """Where a source-map entry belongs in the recovered tree (map directory + sourceRoot + source)."""
    source = str(source or "").strip()
    source = _SCHEME.sub("", source)
    source = unquote(source)
    joined = posixpath.normpath(posixpath.join(posixpath.dirname(map_path), str(source_root or ""), source))
    return clean_path(joined)


# ------------------------------------------------------------------ reading an app folder or .asar

def _asar_index(path: Path) -> dict[str, dict]:
    """The files in one .asar: logical path -> {offset, size, executable}. Offsets are relative to the data."""
    try:
        with open(path, "rb") as f:
            first = f.read(8)
            if len(first) < 8:
                raise SourceError("that .asar is too short to be an archive")
            _, header_size = struct.unpack("<II", first)
            if header_size <= 0 or header_size > MAX_ASAR_HEADER:
                raise SourceError("that .asar's header is invalid")
            block = f.read(header_size)
    except OSError as e:
        raise SourceError(f"couldn't read that .asar: {e}") from e
    if len(block) < 8:
        raise SourceError("that .asar's header is truncated")
    payload, text_len = struct.unpack("<II", block[:8])
    if text_len <= 0 or text_len > len(block) - 8 or payload < text_len:
        raise SourceError("that .asar's header is invalid")
    try:
        header = json.loads(block[8:8 + text_len].decode("utf-8").rstrip("\x00"))
    except (UnicodeDecodeError, ValueError) as e:
        raise SourceError(f"that .asar's header isn't JSON: {e}") from e
    base = 8 + header_size  # the first byte of the archive's file data
    files: dict[str, dict] = {}

    def walk(node: dict, prefix: str, depth: int) -> None:
        if depth > 40 or len(files) >= MAX_SCAN_FILES:
            return
        for name, info in (node.get("files") or {}).items():
            name = str(name)
            logical = f"{prefix}{name}"
            if not isinstance(info, dict):
                continue
            if "files" in info:
                if name in SKIP_DIRS:
                    continue
                walk(info, logical + "/", depth + 1)
                continue
            try:
                offset = int(info.get("offset") or 0)
                size = int(info.get("size") or 0)
            except (TypeError, ValueError):
                continue
            if size < 0 or offset < 0:
                continue
            files[logical] = {"offset": base + offset, "size": size,
                              "executable": bool(info.get("executable"))}

    walk(header, "", 0)
    return files


def target_files(target: str | Path) -> list[str]:
    """The files inside an app folder or .asar, relative and POSIX, bounded."""
    target = Path(target)
    if target.is_dir():
        out = []
        try:
            for path in target.rglob("*"):
                if len(out) >= MAX_SCAN_FILES:
                    break
                if path.is_symlink() or not path.is_file():
                    continue
                rel = path.relative_to(target)
                if any(part in SKIP_DIRS for part in rel.parts):
                    continue
                out.append(rel.as_posix())
        except OSError:
            return out
        return sorted(out)
    if target.suffix.lower() == ".asar" and target.is_file():
        try:
            return sorted(_asar_index(target))
        except SourceError:
            return []
    return []


def read_target_file(target: str | Path, name: str) -> bytes | None:
    """One file's bytes from an app folder or .asar, or None when it is missing or too large."""
    target = Path(target)
    name = clean_path(name)
    if not name:
        return None
    try:
        if target.is_dir():
            path = (target / name).resolve()
            if not path.is_file() or target.resolve() not in path.parents:
                return None
            if path.stat().st_size > MAX_FILE_BYTES:
                return None
            return path.read_bytes()
        if target.suffix.lower() == ".asar" and target.is_file():
            entry = _asar_index(target).get(name)
            if not entry or entry["size"] > MAX_FILE_BYTES:
                return None
            with open(target, "rb") as f:
                f.seek(entry["offset"])
                return f.read(entry["size"])
    except (OSError, SourceError):
        return None
    return None


# ------------------------------------------------------------------ source maps

def _inline_map(raw: bytes) -> dict | None:
    """The source map in an inline `//# sourceMappingURL=data:...` comment, if the script ends with one."""
    try:
        text = raw[-16 * 1024:].decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None
    match = re.search(r"sourceMappingURL=data:application/json([^,]*),([^\s*]+)", text)
    if not match:
        return None
    meta, payload = match.group(1), match.group(2).strip()
    try:
        decoded = base64.b64decode(payload, validate=False) if "base64" in meta else unquote(payload).encode("utf-8")
        value = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _add_map(out: dict[str, dict], map_name: str, raw: bytes, counters: dict) -> None:
    if len(raw) > MAX_FILE_BYTES:
        counters["skipped"] += 1
        return
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        counters["skipped"] += 1
        return
    if not isinstance(value, dict):
        counters["skipped"] += 1
        return
    sources = value.get("sources") or []
    contents = value.get("sourcesContent") or []
    if not isinstance(sources, list) or not isinstance(contents, list):
        counters["skipped"] += 1
        return
    counters["maps"] += 1
    root = str(value.get("sourceRoot") or "")
    for source, content in zip(sources, contents, strict=False):
        if not isinstance(content, str) or not content or "\x00" in content:
            continue
        if len(content.encode("utf-8", "ignore")) > MAX_SOURCE_BYTES:
            counters["skipped"] += 1
            continue
        path = source_path(map_name, root, str(source))
        if not path or path in out:
            continue
        out[path] = {"source": content, "map": map_name}


def recover(target: str | Path) -> dict:
    """Every original source a source map in this app still carries.

    Returns {"files": {path: {source, map}}, "maps": n, "skipped": n, "truncated": bool}. The app is only read.
    """
    target = Path(target)
    files = target_files(target)
    out: dict[str, dict] = {}
    counters = {"maps": 0, "skipped": 0}
    total = 0
    truncated = len(files) >= MAX_SCAN_FILES
    for name in files:
        if counters["maps"] >= MAX_MAPS:
            truncated = True
            break
        lower = name.lower()
        lower_ext = posixpath.splitext(lower)[1]
        if lower_ext != ".map" and lower_ext not in SOURCE_EXTS:
            continue
        raw = read_target_file(target, name)
        if not raw:
            continue
        size = len(raw)
        if total + size > MAX_RECOVERED_BYTES * 2:  # maps and scripts read while scanning
            truncated = True
            break
        total += size
        if lower_ext == ".map":
            _add_map(out, name, raw, counters)
        else:
            inline = _inline_map(raw)
            if inline is not None:
                _add_map(out, name, json.dumps(inline).encode("utf-8"), counters)
    return {"files": out, "maps": counters["maps"], "skipped": counters["skipped"], "truncated": truncated}


# ------------------------------------------------------------------ the application graph's modules

def application_modules(value) -> list[dict]:
    """Files the application graph names, as reconstruction candidates: [{path, kind, node_id}]."""
    if not isinstance(value, dict):
        return []
    value = value.get("result") if isinstance(value.get("result"), dict) else value
    graph = value.get("graph") if isinstance(value.get("graph"), dict) else {}
    found: dict[str, dict] = {}
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict) or node.get("kind") not in MODULE_KINDS:
            continue
        identity = node.get("identity") if isinstance(node.get("identity"), dict) else {}
        raw = identity.get("original_source") if node.get("kind") == "source-module" else identity.get("path")
        raw = raw or identity.get("key") or ""
        path = clean_path(str(raw))
        if not path or posixpath.splitext(path.lower())[1] not in SOURCE_EXTS:
            continue
        if any(part in SKIP_DIRS for part in path.split("/")):
            continue
        found.setdefault(path, {"path": path, "kind": str(node.get("kind") or ""),
                                "node_id": str(node.get("node_id") or "")})
    return sorted(found.values(), key=lambda m: m["path"])


def plan(modules: list[dict], recovered: dict[str, dict]) -> list[dict]:
    """Match graph modules to recovered originals; the rest are reconstruction work items."""
    by_base: dict[str, list[str]] = {}
    for path in recovered:
        by_base.setdefault(posixpath.basename(path), []).append(path)
    claimed: set[str] = set()
    restored: list[dict] = []
    for module in modules:
        path = module["path"]
        hit = path if path in recovered else (by_base.get(posixpath.basename(path)) or [None])[0]
        if hit and len(by_base.get(posixpath.basename(path), [])) == 1 and hit not in claimed:
            claimed.add(hit)
            restored.append({**module, "source": recovered[hit]["source"], "map": recovered[hit]["map"], "path": hit})
        else:
            restored.append({**module, "source": None, "map": ""})
    return restored
