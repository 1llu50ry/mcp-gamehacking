"""Reference folders: folders the user names in a project's instructions (another decomp of the same game, notes,
headers), which agents of a ROM project can read and search with read_file and search_code. Read-only, text only."""
from __future__ import annotations

import os
import re
from pathlib import Path

from ..network import NetworkError

# Never walked: version control, builds, toolchains, the original game files, worktrees, environments.
SKIP = {".git", ".worktrees", "build", "toolchain", "orig", ".venv", "venv", "node_modules", "__pycache__"}
TEXT = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".inc", ".inl", ".s", ".asm", ".csv", ".md", ".txt",
        ".json", ".toml", ".yaml", ".yml", ".py", ".ld", ".map"}
_START = re.compile(r"(?<![\w.])(~/|/|[A-Za-z]:[\\/])")


def named(text: str) -> list[Path]:
    """Folders named in `text`: each absolute path (or ~/...) that exists, the longest that does, so spaces in
    names survive ("/home/me/Total Annihilation/byte-tactics for clues" -> .../byte-tactics). Never the
    filesystem root, the home folder or anything above it."""
    home = Path.home().resolve()
    out: list[Path] = []
    for line in text.splitlines():
        for m in _START.finditer(line):
            words = line[m.start():].split(" ")
            for n in range(len(words), 0, -1):
                cand = " ".join(words[:n]).rstrip(".,;:!?)\"'`")
                p = Path(os.path.expanduser(cand))
                if p.is_absolute() and p.is_dir():
                    p = p.resolve()
                    if p != Path(p.anchor) and p != home and p not in home.parents and p not in out:
                        out.append(p)
                    break
    return out


def _inside(roots: list[Path], path: str) -> Path:
    """`path` (absolute, relative to the first folder, or starting with a folder's name) inside one of the folders,
    symlinks resolved; anything else is refused."""
    raw = Path(os.path.expanduser(path.strip().strip("`'\"") or "."))
    cands = [raw] if raw.is_absolute() else [roots[0] / raw] + [r.parent / raw for r in roots if raw.parts[:1] == (r.name,)]
    for c in cands:
        p = c.resolve()
        for r in roots:
            if (p == r or r in p.parents) and not any(x.startswith(".") or x in SKIP for x in p.relative_to(r).parts):
                return p
    raise NetworkError(f"{path} isn't inside the reference folders ({', '.join(str(r) for r in roots)})")


def read(roots: list[Path], path: str, start: int = 1, count: int = 200) -> str:
    p = _inside(roots, path)
    if p.is_dir():
        items = sorted((x for x in p.iterdir() if not x.name.startswith(".") and x.name not in SKIP),
                       key=lambda x: (not x.is_dir(), x.name.lower()))
        listing = [f"  {x.name}/" if x.is_dir() else f"  {x.name}" for x in items[:300]]
        more = f"\n  ... and {len(items) - 300} more" if len(items) > 300 else ""
        return f"{p} is a folder ({len(items)} entries):\n" + "\n".join(listing) + more
    if not p.is_file():
        raise NetworkError(f"{path} isn't a file")
    with open(p, "rb") as f:
        head = f.read(8192)
    if b"\0" in head or p.stat().st_size > 4 * 1024 * 1024:
        raise NetworkError(f"{path} isn't a source or text file")  # never the game's own files
    lines = p.read_text(errors="replace", encoding="utf-8").splitlines()
    start = max(1, int(start))
    chunk = lines[start - 1:start - 1 + max(1, min(int(count), 600))]
    out = [f"{p} (lines {start}-{start + len(chunk) - 1} of {len(lines)})"]
    out += [f"{start + i:5d}  {line}" for i, line in enumerate(chunk)]
    return "\n".join(out)


def search(roots: list[Path], pattern: str, glob: str = "") -> str:
    """Lines matching `pattern` (a regular expression, case-insensitive) in the folders' text files."""
    try:
        rx = re.compile(pattern, re.IGNORECASE)
    except re.error:  # e.g. "func(": search for the text itself
        rx = re.compile(re.escape(pattern), re.IGNORECASE)
    hits = []
    for root in roots:
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x not in SKIP)
            for name in sorted(files):
                p = Path(d) / name
                rel = p.relative_to(root)
                if name.startswith(".") or p.suffix.lower() not in TEXT or (glob and not rel.match(glob)):
                    continue
                try:
                    if p.stat().st_size > 4 * 1024 * 1024:
                        continue
                    text = p.read_text(errors="replace", encoding="utf-8")
                except OSError:
                    continue
                for i, line in enumerate(text.splitlines(), 1):
                    if rx.search(line):
                        where = rel.as_posix() if len(roots) == 1 else f"{root.name}/{rel.as_posix()}"
                        hits.append(f"{where}:{i}: {line.strip()[:160]}")
                        if len(hits) >= 80:
                            return "\n".join([*hits, "... (more matches; narrow the pattern or the glob)"])
    return "\n".join(hits) or "no matches"


def prompt_line(roots: list[Path]) -> str:
    """What agents are told about the folders."""
    return ("Reference folders the user pointed you to (read-only; read_file and search_code work on them, paths "
            "relative to the first one): " + ", ".join(str(r) for r in roots) + ". They may hold another decomp "
            "of this game: search an address as 0x plus lowercase hex without leading zeros (sub_00401070 -> "
            "0x401070) to find its name, types and source there, then use what fits (rename_symbol, edit_context).")
