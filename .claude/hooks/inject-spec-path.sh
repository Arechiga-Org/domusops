#!/usr/bin/env bash
# UserPromptSubmit
# Emits the path of the active spec only — never its contents — so the
# agent knows where to look without paying the token cost every turn.

set -euo pipefail

# Spec Kit records the current feature in .specify/feature.json; the last
# directory by name is only a fallback (006 sorts before 012).
active_spec_dir="$(sed -n 's/.*"feature_directory": *"\([^"]*\)".*/\1\//p' .specify/feature.json 2>/dev/null || true)"
if [[ -z "$active_spec_dir" ]]; then
  active_spec_dir="$(ls -1d specs/*/ 2>/dev/null | tail -n1 || true)"
fi

if [[ -n "$active_spec_dir" ]]; then
  echo "Active spec directory: ${active_spec_dir}"
fi
