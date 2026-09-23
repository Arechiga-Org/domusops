#!/usr/bin/env bash
# PostToolUse: Write|Edit
# Formats the touched file and runs an incremental typecheck. Failures are
# surfaced to the agent via stderr + non-zero exit so they self-correct
# without spending a human turn.

set -euo pipefail

payload="$(cat)"
path="$(jq -r '.tool_input.file_path // empty' <<<"$payload")"

[[ -z "$path" ]] && exit 0
[[ ! -f "$path" ]] && exit 0

case "$path" in
  *.ts|*.tsx|*.js|*.json|*.md|*.yml|*.yaml)
    npx --no-install prettier --write "$path" 2>/dev/null || true
    ;;
esac

case "$path" in
  *.ts|*.tsx)
    if ! npx --no-install tsc --noEmit -p "$(dirname "$path")" >/tmp/tsc-out 2>&1; then
      echo "TYPECHECK FAILED after editing ${path}:" >&2
      cat /tmp/tsc-out >&2
      exit 1
    fi
    ;;
esac

exit 0
