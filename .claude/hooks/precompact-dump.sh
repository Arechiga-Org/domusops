#!/usr/bin/env bash
# PreCompact
# Safety net against context loss. Not committed — .claude/scratch/ is gitignored.

set -euo pipefail

mkdir -p .claude/scratch
ts="$(date -u +%Y%m%dT%H%M%SZ)"
{
  echo "# Pre-compact snapshot — ${ts}"
  echo
  echo "## git status"
  git status --short 2>/dev/null || true
  echo
  echo "## current branch"
  git branch --show-current 2>/dev/null || true
} > ".claude/scratch/precompact-${ts}.md"
