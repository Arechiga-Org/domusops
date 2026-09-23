#!/usr/bin/env bash
# UserPromptSubmit
# Emits the path of the active spec only — never its contents — so the
# agent knows where to look without paying the token cost every turn.

set -euo pipefail

active_spec_dir="$(ls -1d specs/*/ 2>/dev/null | tail -n1 || true)"

if [[ -n "$active_spec_dir" ]]; then
  echo "Active spec directory: ${active_spec_dir}"
fi
