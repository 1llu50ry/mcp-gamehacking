#!/usr/bin/env bash
# Fail if any CHANGELOG version section repeats a `### ` heading.
#
# `bin/release` copies `## [Unreleased]` into the new version section
# verbatim. A duplicated heading there ships release notes with, say, two
# separate "Fixed" lists and the entries split between them — and nothing
# else catches it, because a duplicate heading is valid Markdown.
#
# This is not hypothetical: it happened twice in one day, both times from
# a maintainer adding a section at the top of `[Unreleased]` while an
# equivalent one already sat further down after an earlier merge.
#
# Merging on merge, rather than rejecting, would hide the conflict from
# whoever wrote the second entry; failing loudly keeps the choice with a
# human.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG="${1:-$REPO_ROOT/CHANGELOG.md}"

if [[ ! -f "$CHANGELOG" ]]; then
    echo "check-changelog-sections: $CHANGELOG not found" >&2
    exit 2
fi

status=0
current=""

while IFS= read -r line; do
    case "$line" in
        '## ['*)
            current="${line#\#\# }"
            seen=" "
            ;;
        '### '*)
            [[ -n "$current" ]] || continue
            heading="${line#\#\#\# }"
            # Trailing whitespace should not create a distinct heading.
            heading="${heading%"${heading##*[![:space:]]}"}"
            if [[ "$seen" == *" ${heading} "* ]]; then
                echo "error: ${current} repeats the '### ${heading}' heading." >&2
                status=1
            else
                seen="${seen}${heading} "
            fi
            ;;
    esac
done < "$CHANGELOG"

if [[ $status -ne 0 ]]; then
    cat >&2 <<'EOF'

Each version section may use a given heading only once. Merge the entries
under a single heading, in Keep a Changelog order:

    Added, Changed, Deprecated, Removed, Fixed, Security

(this project also uses Improved, placed after Changed).
EOF
    exit 1
fi

echo "CHANGELOG section headings are unique within every version."
