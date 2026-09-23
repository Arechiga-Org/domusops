#!/usr/bin/env bash
# PreToolUse: Write|Edit
# Cheap, high-precision patterns only. This is a last-line guard, not a
# substitute for SOPS/age or for `ha-secrets-audit` (domusops-pro).

set -euo pipefail

payload="$(cat)"
content="$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$payload")"

patterns=(
  'ghp_[A-Za-z0-9]{36}'                 # GitHub PAT
  'sk-ant-[A-Za-z0-9_-]{20,}'           # Anthropic API key
  'AKIA[0-9A-Z]{16}'                    # AWS access key ID
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' # JWT-shaped
)

for p in "${patterns[@]}"; do
  if grep -qP "$p" <<<"$content"; then
    echo "BLOCKED: content matches a credential pattern (${p}). Move it to .env / SOPS instead." >&2
    exit 2
  fi
done

exit 0
