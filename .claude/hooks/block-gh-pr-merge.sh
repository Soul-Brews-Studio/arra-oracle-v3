#!/bin/bash
# PreToolUse hook (Bash matcher): force an explicit permission prompt before
# `gh pr merge` runs, closing the one CLAUDE.md safety rule that had zero
# mechanical enforcement ("NEVER MERGE PULL REQUESTS WITHOUT EXPLICIT USER
# PERMISSION"). Every other Critical Safety Rule in CLAUDE.md is still pure
# documentation — this hook only covers this one command.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -Eq '(^|[;&|]|\s)gh\s+pr\s+merge(\s|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "gh pr merge merges a PR — CLAUDE.md requires explicit user permission for this every time, not a standing approval. Confirm with the user before proceeding."
    }
  }'
else
  exit 0
fi
