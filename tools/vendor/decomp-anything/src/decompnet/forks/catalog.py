"""Public matching decompilation projects with their progress, as decomp.dev listed them.

decomp.dev retired its project directory on 2026-10-15 (projects.json answers 410 Gone; each project's own page
stays). decomp.wtf no longer asks for it: an install shows the list it downloaded before, if any, and public decomps
are forked by their repository address, after a look at what the project says about AI (forks/policy.py)."""

from __future__ import annotations

import json
from pathlib import Path

PLATFORMS = {
    "n64": "Nintendo 64", "gc": "GameCube", "wii": "Wii", "ps": "PlayStation", "ps2": "PlayStation 2",
    "psp": "PSP", "gba": "Game Boy Advance", "nds": "Nintendo DS", "3ds": "Nintendo 3DS", "switch": "Switch",
    "win32": "Windows PC", "xbox": "Xbox", "xbox360": "Xbox 360",
}


def normalize(raw: dict) -> list[dict]:
    out = []
    for p in raw.get("projects", []):
        m = p.get("measures") or {}
        out.append({
            "id": f"{p['owner']}/{p['repo']}", "name": p.get("name") or p["repo"], "platform": p.get("platform", ""),
            "platform_name": PLATFORMS.get(p.get("platform", ""), (p.get("platform") or "").upper()),
            "repo_url": p.get("repo_url") or f"https://github.com/{p['owner']}/{p['repo']}",
            "version": p.get("default_version"), "matched": round(m.get("matched_code_percent", 0.0), 2),
            "functions": m.get("total_functions", 0), "matched_functions": m.get("matched_functions", 0),
            "updated": (p.get("commit") or {}).get("timestamp"),
        })
    out.sort(key=lambda p: p["updated"] or "", reverse=True)
    return out


def _cached(cache: Path) -> list[dict] | None:
    try:
        return normalize(json.loads(cache.read_text(encoding="utf-8")))
    except (OSError, ValueError, KeyError):
        return None


def catalog(cache: Path) -> list[dict]:
    """The list this install downloaded from decomp.dev before it retired its directory ([] when none)."""
    return _cached(cache) or []


def cached_at(cache: Path) -> float | None:
    """When the list on disk was downloaded."""
    try:
        return cache.stat().st_mtime
    except OSError:
        return None
