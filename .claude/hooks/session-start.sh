#!/usr/bin/env bash
# SessionStart
# Keep this output under ~300 tokens. It is paid on every session.

set -euo pipefail

branch="$(git branch --show-current 2>/dev/null || echo 'unknown')"
# The current feature from .specify/feature.json; the last directory by name is
# only a fallback.
active_spec="$(sed -n 's/.*"feature_directory": *"specs\/\([^"]*\)".*/\1/p' .specify/feature.json 2>/dev/null || true)"
if [[ -z "$active_spec" ]]; then
  active_spec="$(ls -1 specs 2>/dev/null | tail -n1 || true)"
fi

cat <<EOF
DomusOps session start.
Branch: ${branch}
Active spec: ${active_spec:-none}
Constitution: .specify/memory/constitution.md — §1 (English-only) is hook-enforced, not optional.
EOF
