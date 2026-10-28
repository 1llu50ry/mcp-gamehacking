#!/usr/bin/env bash
# Fail if a change adds or edits entries inside an already-released
# CHANGELOG section.
#
# `bin/release` renames `## [Unreleased]` to `## [X.Y.Z]`. A branch opened
# before that release still carries a CHANGELOG diff anchored at the old
# `[Unreleased]` line numbers, and git merges it into whatever section now
# occupies them — no conflict, no warning. The entry then claims a change
# shipped in a release that did not contain it, and the release that *did*
# ship it lists nothing.
#
# Three times in one week: #491 into [1.32.0], #502 into [1.32.2], #517 into
# [1.33.0]. Each found by hand, twice only because an unrelated merge
# conflict forced someone to look at the file.
#
# Usage: check-changelog-frozen.sh [base-ref]   (default: origin/main)
#
# Rejects a released section (in CHANGELOG.md or docs/changelog/) whose text
# differs from the base branch's copy of that version, a compare link that
# changed, and a released section that disappeared. Deliberate historical
# corrections on the default branch are unaffected: this asks what a branch
# changes relative to the base, not what the file looks like versus a tag.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${1:-origin/main}"
git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || {
    echo "check-changelog-frozen: base ref '$BASE_REF' not found; skipping."
    exit 0
}

# Compare each released section against the base branch's copy of the same
# version, rather than diffing line ranges since the merge base: the range form
# fired falsely on any branch that merged the base after a release. Sections are
# matched by version across CHANGELOG.md and the per-major archive under
# docs/changelog/, so moving a finished major line there is not an edit. A
# branch that predates the base's newest release is stale, not a rewrite, and
# is skipped.
exec python3 "$REPO_ROOT/scripts/changelog_sections.py" frozen "$BASE_REF" --root "$REPO_ROOT"
