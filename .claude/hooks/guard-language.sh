#!/usr/bin/env bash
# PreToolUse: Write|Edit
# Blocks Spanish-language content in repository artifacts (constitution §1).
# Reads the tool payload on stdin; exit 2 blocks the call and returns the
# stderr message to the agent for self-correction.

set -euo pipefail

payload="$(cat)"
path="$(jq -r '.tool_input.file_path // empty' <<<"$payload")"
content="$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$payload")"

[[ -z "$path" ]] && exit 0

# Only guard repository artifacts. Scratch and local notes are exempt.
case "$path" in
  *.ts|*.tsx|*.js|*.py|*.sh|*.md|*.yml|*.yaml|*.json) ;;
  *) exit 0 ;;
esac
case "$path" in
  */.claude/scratch/*|*/NOTES.local.md) exit 0 ;;
esac

# Signal 1: Spanish-specific characters.
if grep -qP '[áéíóúñ¿¡Ñ]' <<<"$content"; then
  echo "BLOCKED: repository artifacts must be written in English (constitution §1). Detected Spanish diacritics in ${path}." >&2
  exit 2
fi

# Signal 2: high-frequency Spanish stopwords as whole words.
hits=$(grep -oiwE 'el|la|los|las|que|para|con|una|este|esta|pero|porque|cuando|donde|desde|hasta|sobre' <<<"$content" | wc -l)
words=$(wc -w <<<"$content")
if (( words > 30 )) && (( hits * 100 / words > 8 )); then
  echo "BLOCKED: repository artifacts must be written in English (constitution §1). Spanish stopword density ${hits}/${words} in ${path}." >&2
  exit 2
fi

exit 0
