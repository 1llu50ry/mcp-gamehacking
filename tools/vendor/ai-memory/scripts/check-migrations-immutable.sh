#!/usr/bin/env bash
set -euo pipefail

base_ref=${1:-origin/main}
if ! git rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null; then
  echo "check-migrations-immutable: base ref '$base_ref' not found; skipping" >&2
  exit 0
fi

merge_base=$(git merge-base "$base_ref" HEAD)
status=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  if git cat-file -e "$merge_base:$path" 2>/dev/null; then
    echo "existing migration changed: $path" >&2
    status=1
  fi
done < <(
  git diff --name-only "$merge_base"...HEAD -- \
    'crates/ai-memory-store/migrations/V*.sql'
)

if (( status != 0 )); then
  echo "shipped migrations are immutable; add a new Vnn migration instead" >&2
fi
exit "$status"
