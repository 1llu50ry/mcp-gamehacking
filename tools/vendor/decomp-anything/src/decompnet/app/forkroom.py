"""Rooms for projects that are git source trees: GameCube, Wii and DS games started from scratch, and forks of public
decomps. The host's tree is the room's truth.

Every member works in their own copy of the tree, with their own copy of the game and their own compilers: an agent
compiles and diffs on its own computer (the game's code never travels). What travels is the work, as in rooms for
ROM projects (collab.py):
- claims go through the host, so nobody does the same function twice;
- a member's match is sent to the host, which builds it in its own tree against its own copy and commits it;
- edits of other files (headers, new source files, split files) are made by the host, which checks them the same way;
- members follow the host's commits as git bundles: only what the repository tracks, never the game, its extracted
  files or the build (those are gitignored in every project decomp.wtf makes or forks).
A public decomp's members get the project from its own host (GitHub, ...) at the commit the room's host started from;
the bundle then only holds the room's own commits.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from ..forks import scratch_dsd, scratch_dtk
from ..forks.project import ForkError, ForkProject
from ..network import NetworkError

MAX_BUNDLE = 512 * 1024 * 1024


def _git(root: Path, *args: str, check: bool = True, timeout: float = 600) -> str:
    res = subprocess.run(["git", "-c", "safe.directory=*", *args], cwd=root, capture_output=True, text=True,
                         encoding="utf-8", errors="replace", timeout=timeout)
    if check and res.returncode != 0:
        raise NetworkError(f"git {args[0]} failed: {(res.stderr or res.stdout).strip()[-400:]}")
    return res.stdout.strip()


def game_identity(path: Path) -> str:
    """Which game a file is, whatever form it comes in: a DS ROM's own bytes; a GameCube/Wii disc's main program
    (any disc format; a DOL on its own too); any other game file's bytes."""
    with open(path, "rb") as f:
        head = f.read(0x440)
    if scratch_dsd.is_nds(head):
        return _sha1_file(path)
    try:
        if scratch_dtk.is_dol(head if path.stat().st_size >= 64 << 20 else path.read_bytes()) or \
                scratch_dtk.disc_kind(head) is not None:
            return hashlib.sha1(scratch_dtk.game_info(path)["dol"]).hexdigest()
    except ForkError:
        pass
    return _sha1_file(path)


def _sha1_file(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def project_identity(cfg: dict) -> str | None:
    """The game a project is for, as game_identity says it (None: not known, the build checks it)."""
    return (cfg.get("rom") or {}).get("sha1") or cfg.get("program_sha1") or cfg.get("game_sha1")


# ---------------------------------------------------------------------------------------------- host

def head(root: Path) -> str:
    return _git(root, "rev-parse", "HEAD")


def branch(root: Path) -> str:
    return _git(root, "rev-parse", "--abbrev-ref", "HEAD")


def base(root: Path) -> str | None:
    """A shallow clone's oldest commit: the public decomp's commit the room's work starts from."""
    shallow = Path(root) / ".git" / "shallow"
    if not shallow.exists():
        return None
    roots = _git(root, "rev-list", "--max-parents=0", "HEAD").split()
    return roots[0] if roots else None


def bundle(root: Path, have: str = "") -> bytes:
    """The host's commits a member doesn't have yet (all of them for a new member), as a git bundle. Empty when the
    member is up to date."""
    root = Path(root)
    tip, ref = head(root), branch(root)
    if have == tip:
        return b""
    start, first = "", base(root)  # a public decomp's members have its commits from its own host
    if have and subprocess.run(["git", "-c", "safe.directory=*", "merge-base", "--is-ancestor", have, tip], cwd=root,
                               capture_output=True).returncode == 0:
        start = have
    elif first:
        if first == tip:  # nothing on top of the public decomp yet
            return b""
        start = first
    with tempfile.TemporaryDirectory(prefix="decomp-room-") as tmp:
        out = Path(tmp) / "room.bundle"
        _git(root, "bundle", "create", str(out), f"{start}..{ref}" if start else ref)
        data = out.read_bytes()
    if len(data) > MAX_BUNDLE:
        raise NetworkError("the project's history is too large to send")
    return data


def hello(net, slug: str) -> dict:
    """What a member needs to know about a git project's room before joining (no game data)."""
    proj, fp, cfg = net.forks.get(slug)
    return {"kind": "fork", "title": proj["name"], "game_code": cfg.get("version") or "", "region": "",
            "platform": cfg.get("platform"), "origin": cfg.get("origin") or "public", "repo_url": cfg.get("repo_url"),
            "version": cfg.get("version"), "fork_kind": cfg.get("fork_kind"), "sha1": project_identity(cfg),
            "compiler": cfg.get("compiler"), "base": base(fp.root) if cfg.get("repo_url") else None,
            "head": head(fp.root), "branch": branch(fp.root)}


# ---------------------------------------------------------------------------------------------- member

def fetch_bundle(root: Path, data: bytes, ref: str) -> str:
    """Take the host's commits from a bundle; returns the host's head."""
    with tempfile.TemporaryDirectory(prefix="decomp-room-") as tmp:
        f = Path(tmp) / "room.bundle"
        f.write_bytes(data)
        _git(root, "fetch", "-q", str(f), "+refs/heads/*:refs/remotes/room/*")
    return _git(root, "rev-parse", f"refs/remotes/room/{ref}")


def clone(dest: Path, info: dict, get_bundle, log=print) -> None:
    """A member's copy of the room's tree: the public decomp at the host's starting commit (if it is one), then the
    room's own commits from the host. `get_bundle(have)` asks the host."""
    dest.mkdir(parents=True)
    _git(dest, "init", "-q")
    have = ""
    if info.get("repo_url"):
        log(f"getting the project from {info['repo_url']}")
        _git(dest, "remote", "add", "origin", info["repo_url"])
        if info.get("base"):
            got = subprocess.run(["git", "-c", "safe.directory=*", "fetch", "-q", "--depth", "1", "origin", info["base"]],
                                 cwd=dest, capture_output=True, text=True).returncode == 0
            if not got:  # a host that doesn't serve commits by id: its history, until the commit is there
                _git(dest, "fetch", "-q", "origin", timeout=3600)
            have = info["base"]
            _git(dest, "checkout", "-q", have)
        else:
            _git(dest, "fetch", "-q", "--depth", "1", "origin")
    log("getting the room's work from the host")
    data = get_bundle(have)
    if data:
        tip = fetch_bundle(dest, data, info["branch"])
        _git(dest, "checkout", "-q", "-B", info["branch"], tip)
    elif have:
        _git(dest, "checkout", "-q", "-B", info["branch"], have)
    if (dest / ".gitmodules").exists():
        _git(dest, "submodule", "update", "--init", "--depth", "1", timeout=3600)


def pull(root: Path, data: bytes, ref: str) -> str:
    """Move the member's tree to the host's head. Work in progress in files (an agent's latest attempt) is kept unless
    the host changed the same lines; the member's own commits are dropped: the host has them (it confirmed and
    committed every match the member sent), or they didn't hold up there. Returns the new head."""
    tip = fetch_bundle(root, data, ref)
    dirty = bool(_git(root, "status", "--porcelain", "--untracked-files=no"))
    if dirty:
        _git(root, "stash", "push", "-q", "-m", "decomp.wtf: work in progress before following the room")
    _git(root, "reset", "-q", "--hard", tip)
    if dirty and subprocess.run(["git", "-c", "safe.directory=*", "stash", "pop", "-q"], cwd=root,
                                capture_output=True).returncode != 0:
        _git(root, "reset", "-q", "--hard", tip)  # the host changed the same lines: the host's version stays
        _git(root, "stash", "drop", "-q", check=False)
    return tip


def register_member(net, slug: str, root: Path, info: dict, host_title: str) -> dict:
    """The project's settings on the member's side, as the host has them."""
    cfg = {"kind": "fork", "origin": info.get("origin") if info.get("origin") == "scratch" else None,
           "repo_url": info.get("repo_url"), "platform": info.get("platform") or "", "version": info.get("version"),
           "fork_kind": ForkProject(root).kind(), "ready": False, "compiler": info.get("compiler"),
           "legal": {"basis": "personal-copy", "license": "personal use only",
                     "statement": "joined a room with the member's own copy of the game, confirmed legally obtained"}}
    if info.get("sha1"):
        cfg["program_sha1" if info.get("origin") == "scratch" else "game_sha1"] = info["sha1"]
    net.forks._register(slug, info["title"], f"{info['title']}, together with {host_title}", root, cfg,
                        f"joined {host_title}'s room")
    return cfg


def save_head(net, slug: str, tip: str) -> None:
    proj = net.project_row(slug)
    cfg = json.loads(proj["config"])
    if (cfg.get("link") or {}).get("head") != tip:
        cfg.setdefault("link", {})["head"] = tip
        with net.store.tx() as db:
            db.execute("UPDATE projects SET config=? WHERE id=?", (json.dumps(cfg), proj["id"]))
