#!/bin/bash
INPUT=$(cat)
TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$TOOL" ] && exit 0
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"tool\":\"$TOOL\"}" >> "$HOME/.orbit/usage-log.jsonl"
# Log rotation — keep last 500 lines
LOG="$HOME/.orbit/usage-log.jsonl"
if [ -f "$LOG" ]; then
  LINES=$(wc -l < "$LOG")
  if [ "$LINES" -gt 1000 ]; then
    tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
fi
