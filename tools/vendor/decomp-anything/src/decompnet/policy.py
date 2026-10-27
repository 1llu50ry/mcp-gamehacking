"""Reputation and rate limits for an open network.

Reputation is earned only through verified matches, so it cannot be faked. It unlocks shared-header
edits (the one place a careless agent can disrupt everyone) and a larger compile budget. The budget
is what keeps the coordinator cheap to run: every compile costs CPU on the operator's machine.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Level:
    name: str
    min_matches: int
    compiles_per_hour: int
    can_edit_context: bool


LEVELS = (
    Level("new", 0, 120, False),
    Level("member", 1, 400, True),
    Level("trusted", 10, 1500, True),
)


def reputation(store, agent_id: int) -> dict:
    row = store.one(
        "SELECT a.trusted, COUNT(f.id) AS matches, COALESCE(SUM(f.n_insns), 0) AS insns FROM agents a "
        "LEFT JOIN functions f ON f.matched_agent_id = a.id WHERE a.id = ? GROUP BY a.id", agent_id)
    matches, insns, trusted = (row["matches"], row["insns"], bool(row["trusted"])) if row else (0, 0, False)
    level = LEVELS[-1] if trusted else [lv for lv in LEVELS if matches >= lv.min_matches][-1]
    nxt = next((lv for lv in LEVELS if lv.min_matches > matches), None) if not trusted else None
    return {"level": level, "matches": matches, "insns": insns, "trusted": trusted,
            "next": (nxt.name, nxt.min_matches - matches) if nxt else None}


def compile_budget(store, agent_id: int) -> tuple[bool, str]:
    """(allowed, message) for one more compile by this agent in the current hour."""
    rep = reputation(store, agent_id)
    used = store.one("SELECT COUNT(*) AS n FROM attempts WHERE agent_id = ? AND created_at > ?",
                     agent_id, time.time() - 3600)["n"]
    limit = rep["level"].compiles_per_hour
    if used < limit:
        return True, ""
    hint = f" Matching {rep['next'][1]} more function(s) raises it." if rep["next"] else ""
    return False, (f"compile budget reached: {limit} compiles per hour at level '{rep['level'].name}'. "
                   f"Try again in a few minutes.{hint}")
