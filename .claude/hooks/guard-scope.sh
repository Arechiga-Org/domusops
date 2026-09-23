#!/usr/bin/env bash
# PreToolUse: Write|Edit
# Blocks writes to paths that own their content structurally
# (constitution, templates, changesets metadata, lockfiles) unless the agent
# is explicitly working on repo governance. Adjust the allowlist as the repo
# grows — this is intentionally conservative at bootstrap.

set -euo pipefail

payload="$(cat)"
path="$(jq -r '.tool_input.file_path // empty' <<<"$payload")"

[[ -z "$path" ]] && exit 0

case "$path" in
  *pnpm-lock.yaml|*/.changeset/README.md)
    echo "BLOCKED: ${path} is generated/managed by tooling, not hand-edited." >&2
    exit 2
    ;;
esac

exit 0
