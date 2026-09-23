#!/usr/bin/env bash
# SessionEnd

set -euo pipefail

if ! git diff --quiet --exit-code -- 'packages/*/src/**' 2>/dev/null; then
  if [[ ! -d .changeset ]] || [[ -z "$(find .changeset -maxdepth 1 -name '*.md' ! -name 'README.md' 2>/dev/null)" ]]; then
    echo "REMINDER: package source changed this session but no changeset was added. Run: pnpm exec changeset" >&2
  fi
fi

exit 0
