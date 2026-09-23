#!/usr/bin/env bash
# Stop
# Gate: don't let a turn end with red tests or lint if source files changed.
# Skips cleanly when there's nothing to check yet (bootstrap-stage repo).

set -euo pipefail

if ! git diff --quiet --exit-code -- '*.ts' '*.tsx' 2>/dev/null; then
  if [[ -f package.json ]] && grep -q '"test"' package.json; then
    if ! pnpm test --silent 2>/tmp/stop-gate-test.log; then
      echo "STOP BLOCKED: tests are red. See /tmp/stop-gate-test.log." >&2
      exit 1
    fi
  fi
fi

exit 0
