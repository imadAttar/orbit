#!/bin/bash
# PreToolUse hook: warn before editing critical config files
# Exit 2 = show warning to Claude (non-blocking)

TOOL_INPUT="$CLAUDE_TOOL_INPUT"

FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

CRITICAL_FILES="tauri.conf.json Cargo.toml package.json tsconfig.json build.yml"

BASENAME=$(basename "$FILE_PATH" 2>/dev/null)

for CRITICAL in $CRITICAL_FILES; do
  if [ "$BASENAME" = "$CRITICAL" ]; then
    echo "WARNING: Editing critical config file: $FILE_PATH"
    echo "Verify this change is intentional and won't break the build."
    exit 2
  fi
done
