#!/bin/bash
# PreToolUse hook: warns when heavy build commands run in main agent context.
# Suggests dedicated sub-agent skills instead.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only check Bash commands
[ "$TOOL_NAME" != "Bash" ] && exit 0

# Skip if running in a sub-agent (sub-agents ARE the right place for builds)
[ -n "$CLAUDE_AGENT_NAME" ] && exit 0

# Skip lightweight npm commands
if echo "$COMMAND" | grep -qE '(--help|list|ls|outdated|install|uninstall|run dev|run tauri dev)'; then
  exit 0
fi

# Warn on heavy build/test commands
if echo "$COMMAND" | grep -qE '^\s*npm\s+(run\s+build|test|run\s+tauri\s+build)'; then
  echo "⚠️  Build/test command detected in main agent context." >&2
  echo "Consider using dedicated sub-agent skills instead:" >&2
  echo "  /build       — npm run build (TypeScript + Vite)" >&2
  echo "  /test        — npm test (Vitest)" >&2
  echo "  /tauri-build — npm run tauri build (full native bundle)" >&2
  echo "" >&2
  echo "Sub-agents keep verbose output out of your context window." >&2
fi

exit 0
