#!/bin/bash
# Orbit session-state hook — writes Claude Code hook payload to ~/.orbit/session-state.json
# which Orbit's filesystem watcher picks up to update UI indicators.
set -eu
target_dir="$HOME/.orbit"
mkdir -p "$target_dir"
cat > "$target_dir/session-state.json"
