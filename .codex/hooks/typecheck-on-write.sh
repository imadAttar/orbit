#!/bin/bash
# PostToolUse hook: run typecheck after writing .ts/.tsx files
# Runs async to not block the main flow

TOOL_INPUT="$CLAUDE_TOOL_INPUT"

# Extract file path from tool input
FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Only check TypeScript files
if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  RESULT=$(cd "$CLAUDE_PROJECT_DIR" && npx tsc --noEmit 2>&1)
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "TYPECHECK ERRORS after writing $FILE_PATH:"
    echo "$RESULT" | head -20
    exit 2  # exit 2 = show warning to Claude
  fi
fi
