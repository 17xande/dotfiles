#!/usr/bin/env bash
# PreToolUse (Write|Edit): approve writes to the shared plans folder.
#
# Each Omarchy Claude account has $CLAUDE_CONFIG_DIR/plans as a symlink to
# ~/.claude/plans so plans are shared between accounts. Claude Code then fails
# to recognise the plan file in plan mode and asks before every plan write.
# This resolves the target path and approves it when it lands in the shared
# folder. Anything else gets no output, so the normal permission flow applies.
set -euo pipefail

plans_dir=$(realpath -m "$HOME/.claude/plans")
file=$(jq -r '.tool_input.file_path // empty')
[[ -n "$file" ]] || exit 0

resolved=$(realpath -m -- "$file")
case "$resolved" in
  "$plans_dir"/*.md)
    jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Shared plan file (~/.claude/plans)"}}'
    ;;
esac
