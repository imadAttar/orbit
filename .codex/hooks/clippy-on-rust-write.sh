#!/bin/bash
# PostToolUse hook: run cargo clippy after writing .rs files
# Runs async to not block the main flow

TOOL_INPUT="$CLAUDE_TOOL_INPUT"

FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

if [[ "$FILE_PATH" == *.rs ]]; then
  RESULT=$(cd "$CLAUDE_PROJECT_DIR" && cargo clippy --quiet 2>&1)
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "CLIPPY WARNINGS after writing $FILE_PATH:"
    echo "$RESULT" | head -20
    exit 2
  fi
fi
