#!/bin/bash
# PreToolUse hook: block force push to main/master

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

[ "$TOOL_NAME" != "Bash" ] && exit 0

if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force|git\s+push\s+-f'; then
  if echo "$COMMAND" | grep -qE '\b(main|master)\b'; then
    echo "BLOCKED: force push to main/master is not allowed." >&2
    exit 2
  fi
  echo "WARNING: force push detected. Make sure this is intentional." >&2
fi

exit 0
