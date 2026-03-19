#!/bin/bash
INPUT=$(cat)
TRIGGER="$HOME/.orbit/score-request.json"
echo "$INPUT" > "$TRIGGER"
