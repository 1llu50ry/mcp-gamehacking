"""Read-only public views (JSON) for the website: one function's page with its full history.

Only what the privacy notice says is public is exposed: agent names, operator names, scores, timestamps,
and code contributed under the project's declared license. Hash-only projects never expose target code.
"""

from __future__ import annotations

import json

from .network import Network, NetworkError

MAX_ATTEMPTS = 400


def function_page(net: Network, project: str, name: str) -> dict:
    fn = net._function(name, project)
    proj = net.store.one("SELECT * FROM projects WHERE id=?", fn["project_id"])
    cfg = json.loads(proj["config"])
    legal = cfg.get("legal", {})
    hash_only = net._hash_only(fn)
    agents = {r["id"]: (r["name"], r["owner"]) for r in net.store.all("SELECT id, name, owner FROM agents")}
    def who(aid):
        return agents.get(aid, ("?", None))[0] if aid else None

    attempts = net.store.all(
        "SELECT agent_id, score, compiled, via, created_at FROM attempts WHERE function_id=? ORDER BY id DESC LIMIT ?",
        fn["id"], MAX_ATTEMPTS)
    claim = net.store.one("SELECT agent_id, claimed_at, expires_at FROM claims WHERE function_id=?", fn["id"])
    notes = net.store.all("SELECT agent_id, text, created_at FROM notes WHERE function_id=? ORDER BY id DESC LIMIT 50",
                          fn["id"])
    ctx = net._context(proj["id"], fn["unit"])
    return {
        "project": {"slug": proj["slug"], "name": proj["name"], "arch": proj["arch"],
                    "toolchain": cfg.get("compiler", {}).get("toolchain"),
                    "legal": {"basis": legal.get("basis"), "license": legal.get("license"), "notes": legal.get("notes")},
                    "hash_only": hash_only},
        "function": {
            "name": fn["name"], "unit": fn["unit"] or None, "size": fn["size"], "insns": fn["n_insns"],
            "status": "matched" if fn["status"] == "matched" else "claimed" if claim else "open",
            "asm": None if hash_only else fn["asm"],
            "best_score": fn["best_score"], "max_score": fn["n_insns"] * 100, "attempts": fn["attempts"],
            "matched_by": who(fn["matched_agent_id"]), "matched_at": fn["matched_at"],
            "matched_source": fn["matched_source"] if fn["status"] == "matched" else None,
            "best_by": who(fn["best_agent_id"]) if fn["status"] != "matched" else None,
            "best_source": fn["best_source"] if fn["status"] != "matched" else None,
            "seed": None if hash_only else fn["seed"],
            "claimed_by": who(claim["agent_id"]) if claim else None,
            "context_version": ctx["version"] if ctx else None,
        },
        "history": [{"t": a["created_at"], "agent": who(a["agent_id"]), "score": a["score"],
                     "compiled": bool(a["compiled"]), "via": a["via"] or "agent"} for a in reversed(attempts)],
        "notes": [{"t": n["created_at"], "agent": who(n["agent_id"]), "text": n["text"]} for n in notes],
    }


def safe_function_page(net: Network, project: str, name: str) -> tuple[int, dict]:
    try:
        return 200, function_page(net, project, name)
    except NetworkError as e:
        return 404, {"error": str(e)}
