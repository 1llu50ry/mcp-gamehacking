"""Exact-text edits as agents send them: `old` must occur once, but whitespace may be off (tabs for spaces, a
re-indented block, a trailing space), and when it isn't there at all the agent is told where the closest text is
so it can retry without reading the whole file again."""

from __future__ import annotations

import difflib
import re

from .network import NetworkError


def _loose(old: str) -> re.Pattern | None:
    words = old.split()
    if not words:
        return None
    return re.compile(r"\s+".join(re.escape(w) for w in words))


def _line(text: str, at: int) -> int:
    return text.count("\n", 0, at) + 1


def _closest(text: str, old: str) -> str:
    lines = text.splitlines()
    wanted = [ln.strip() for ln in old.splitlines() if len(ln.strip()) > 3]
    if not wanted or not lines:
        return ""
    stripped = [ln.strip() for ln in lines]
    best = None
    for w in wanted[:6]:
        for hit in difflib.get_close_matches(w, stripped, n=1, cutoff=0.6):
            k = stripped.index(hit)
            score = difflib.SequenceMatcher(None, w, hit).ratio()
            if best is None or score > best[0]:
                best = (score, k)
    if best is None:
        return ""
    k = best[1]
    lo, hi = max(0, k - 3), min(len(lines), k + 4 + len(wanted))
    shown = "\n".join(f"{i + 1:5d}  {lines[i]}" for i in range(lo, hi))
    return f"\nThe closest text is around line {k + 1}; this is the file now:\n{shown}"


def replace_once(text: str, old: str, new: str, where: str) -> str:
    """`text` with `old` replaced by `new` (`old` must occur once; whitespace may differ)."""
    count = text.count(old)
    if count == 1:
        return text.replace(old, new)
    if count > 1:
        at, lines = 0, []
        while (at := text.find(old, at)) >= 0:
            lines.append(str(_line(text, at)))
            at += len(old)
        raise NetworkError(f"`old` occurs {count} times in {where} (lines {', '.join(lines[:8])}): include more of "
                           f"the surrounding text so it occurs once")
    rx = _loose(old)
    hits = list(rx.finditer(text)) if rx else []
    if len(hits) == 1:
        m = hits[0]
        return text[:m.start()] + new + text[m.end():]
    if len(hits) > 1:
        raise NetworkError(f"`old` occurs {len(hits)} times in {where} (whitespace aside, lines "
                           f"{', '.join(str(_line(text, m.start())) for m in hits[:8])}): include more of the "
                           f"surrounding text so it occurs once")
    raise NetworkError(f"`old` isn't in {where} (it may have changed since you read it).{_closest(text, old)}")
