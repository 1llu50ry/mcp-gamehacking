#!/usr/bin/env python3
"""Released CHANGELOG sections, read across CHANGELOG.md and its archive.

CHANGELOG.md keeps `[Unreleased]` and the current major line. When a new
major ships, `bin/release` moves the previous major's sections and their
compare links into `docs/changelog/<major>.x.md` (`archive`). Released
sections are frozen wherever they live, so `check-changelog-frozen.sh`
compares them per version across both places (`frozen`).

Usage:
  changelog_sections.py archive <major> [--root DIR]
  changelog_sections.py frozen <base-ref> [--root DIR]
"""

import argparse
import pathlib
import re
import subprocess
import sys

HEADING = re.compile(r"^## \[([^\]]+)\]")
LINK_REF = re.compile(r"^\[([^\]]+)\]: \S")
ARCHIVE_DIR = "docs/changelog"


def split(text):
    """Return (preamble, [(version, section_text)], [link_ref_lines])."""
    lines = text.split("\n")
    first = next((i for i, l in enumerate(lines) if HEADING.match(l)), len(lines))
    links_at = len(lines)
    while links_at > first and (
        LINK_REF.match(lines[links_at - 1]) or not lines[links_at - 1].strip()
    ):
        links_at -= 1
    preamble = "\n".join(lines[:first])
    sections = []
    current = None
    for line in lines[first:links_at]:
        m = HEADING.match(line)
        if m:
            current = [m.group(1), [line]]
            sections.append(current)
        elif current is not None:
            current[1].append(line)
    sections = [(v, "\n".join(body).rstrip("\n")) for v, body in sections]
    links = [l for l in lines[links_at:] if LINK_REF.match(l)]
    return preamble, sections, links


def link_version(line):
    m = LINK_REF.match(line)
    return m.group(1) if m else ""


def released(sections):
    return [(v, s) for v, s in sections if v != "Unreleased"]


def archive(major, root):
    changelog = root / "CHANGELOG.md"
    preamble, sections, links = split(changelog.read_text())
    prefix = f"{major}."
    moved = [(v, s) for v, s in sections if v.startswith(prefix)]
    if not moved:
        print(f"changelog: no {major}.x sections to archive")
        return 0
    kept = [(v, s) for v, s in sections if not v.startswith(prefix)]
    moved_links = [l for l in links if link_version(l).startswith(prefix)]
    kept_links = [l for l in links if not link_version(l).startswith(prefix)]

    target = root / ARCHIVE_DIR / f"{major}.x.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    head = (
        f"# Changelog: {major}.x releases (archived)\n\n"
        f"The {major}.x release notes, moved out of the root `CHANGELOG.md` when the\n"
        f"next major line began. They are frozen like every released section.\n"
    )
    body = "\n\n".join(s for _, s in moved)
    target.write_text(head + "\n" + body + "\n\n" + "\n".join(moved_links) + "\n")

    out = with_archive_note(preamble, root).rstrip("\n") + "\n\n" + "\n\n".join(s for _, s in kept)
    changelog.write_text(out + "\n\n" + "\n".join(kept_links) + "\n")
    print(f"changelog: moved {len(moved)} {major}.x sections to {target.relative_to(root)}")
    return 0


ARCHIVE_NOTE = re.compile(r"This file holds the current major line\..*?(?:\n\n|\Z)", re.S)


def with_archive_note(preamble, root):
    """Rewrite the preamble's archive note to list every archived major line."""
    majors = sorted(
        (int(p.name.split(".")[0]) for p in (root / ARCHIVE_DIR).glob("*.x.md")
         if p.name.split(".")[0].isdigit()),
        reverse=True,
    )
    if not majors:
        return preamble
    links = [f"[{m}.x]({ARCHIVE_DIR}/{m}.x.md)" for m in majors]
    listed = links[0] if len(links) == 1 else ", ".join(links[:-1]) + " and " + links[-1]
    note = (
        "This file holds the current major line. Earlier lines are archived per major\n"
        f"version in [`{ARCHIVE_DIR}/`]({ARCHIVE_DIR}/):\n{listed}.\n\n"
    )
    if ARCHIVE_NOTE.search(preamble):
        return ARCHIVE_NOTE.sub(lambda _: note, preamble, count=1)
    return preamble.rstrip("\n") + "\n\n" + note


def git_show(ref, path, root):
    r = subprocess.run(
        ["git", "show", f"{ref}:{path}"], cwd=root, capture_output=True, text=True
    )
    return r.stdout if r.returncode == 0 else None


def git_ls(ref, root):
    r = subprocess.run(
        ["git", "ls-tree", "--name-only", f"{ref}:{ARCHIVE_DIR}"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return r.stdout.split() if r.returncode == 0 else []


def collect(texts):
    sections, links = {}, set()
    for text in texts:
        _, secs, ls = split(text)
        for v, s in released(secs):
            sections[v] = s
        links.update(ls)
    return sections, links


def read_ref(ref, root):
    main = git_show(ref, "CHANGELOG.md", root)
    if main is None:
        return None
    texts = [main]
    for name in git_ls(ref, root):
        if name.endswith(".md"):
            texts.append(git_show(ref, f"{ARCHIVE_DIR}/{name}", root) or "")
    return texts, split(main)[1]


def read_worktree(root):
    texts = [(root / "CHANGELOG.md").read_text()]
    archive_dir = root / ARCHIVE_DIR
    if archive_dir.is_dir():
        texts += [p.read_text() for p in sorted(archive_dir.glob("*.md"))]
    return texts


def frozen(base_ref, root):
    base = read_ref(base_ref, root)
    if base is None:
        print(f"check-changelog-frozen: base ref '{base_ref}' has no CHANGELOG; skipping.")
        return 0
    base_texts, base_main_sections = base
    base_released = released(base_main_sections)
    if not base_released:
        print("check-changelog-frozen: base has no released section yet.")
        return 0
    base_sections, base_links = collect(base_texts)
    head_sections, head_links = collect(read_worktree(root))

    newest = base_released[0][0]
    if newest not in head_sections:
        print(f"check-changelog-frozen: HEAD predates {newest}; nothing to compare.")
        return 0

    problems = []
    # HEAD carries the base's newest release, so it carries every older one
    # too: a section missing from both CHANGELOG.md and the archive was
    # deleted, not merely moved.
    for version, text in base_sections.items():
        if version not in head_sections:
            problems.append(f"section [{version}] was removed")
        elif head_sections[version] != text:
            problems.append(f"section [{version}] differs from the base")
    for line in sorted(base_links):
        if link_version(line) in head_sections and line not in head_links:
            problems.append(f"compare link changed or missing: {line}")
    if not problems:
        print("CHANGELOG: no released section was modified.")
        return 0
    print("error: this change modifies an already-released CHANGELOG section.", file=sys.stderr)
    for p in problems[:40]:
        print(f"  {p}", file=sys.stderr)
    print(
        "\nReleased sections are frozen, in CHANGELOG.md and in docs/changelog/.\n"
        "An entry for unreleased work belongs under `## [Unreleased]`.\n\n"
        "This usually means the branch was opened before a release was cut, and git\n"
        "merged the entry into the section that now occupies those lines. Move it up\n"
        "to `[Unreleased]`; the content does not change, only the section.",
        file=sys.stderr,
    )
    return 1


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("archive")
    a.add_argument("major", type=int)
    a.add_argument("--root", default=".")
    f = sub.add_parser("frozen")
    f.add_argument("base_ref")
    f.add_argument("--root", default=".")
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    if args.cmd == "archive":
        return archive(args.major, root)
    return frozen(args.base_ref, root)


if __name__ == "__main__":
    sys.exit(main())
