#!/usr/bin/env bash
# SessionStart
# Keep this output under ~300 tokens. It is paid on every session.

set -euo pipefail

branch="$(git branch --show-current 2>/dev/null || echo 'unknown')"
active_spec="$(ls -1 specs 2>/dev/null | tail -n1 || true)"

cat <<EOF
DomusOps session start.
Branch: ${branch}
Active spec: ${active_spec:-none}
Constitution: .specify/memory/constitution.md — §1 (English-only) is hook-enforced, not optional.
EOF
