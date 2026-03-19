#!/bin/bash
# Claude Code Status Line
# Shows: model, git branch, context usage bar, cost, lines changed, duration

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

# --- Parse JSON with jq (single pass) ---
eval "$(echo "$INPUT" | jq -r '
  @sh "MODEL=\(.model.display_name // "?")",
  @sh "USED_PCT=\(.context_window.used_percentage // 0 | floor)",
  @sh "CWD=\(.workspace.current_dir // .cwd // "")",
  @sh "CTX_SIZE=\(.context_window.context_window_size // 0)",
  @sh "COST=\(.cost.total_cost_usd // 0)",
  @sh "LINES_ADD=\(.cost.total_lines_added // 0)",
  @sh "LINES_DEL=\(.cost.total_lines_removed // 0)",
  @sh "DURATION_MS=\(.cost.total_duration_ms // 0)"
')"

# --- Context size label ---
if [ "$CTX_SIZE" -ge 1000000 ] 2>/dev/null; then
    CTX_LABEL="1M"
elif [ "$CTX_SIZE" -ge 200000 ] 2>/dev/null; then
    CTX_LABEL="200k"
else
    CTX_LABEL=""
fi

# --- Duration formatting ---
DURATION_SEC=$(( ${DURATION_MS%.*} / 1000 ))
if [ "$DURATION_SEC" -ge 3600 ] 2>/dev/null; then
    DURATION="$((DURATION_SEC / 3600))h$((DURATION_SEC % 3600 / 60))m"
elif [ "$DURATION_SEC" -ge 60 ] 2>/dev/null; then
    DURATION="$((DURATION_SEC / 60))m"
else
    DURATION="${DURATION_SEC}s"
fi

# --- Cost formatting ---
COST_FMT=$(printf '$%.2f' "$COST")

# --- Git info (skip optional locks to avoid contention) ---
BRANCH=$(git -C "$CWD" --no-optional-locks branch --show-current 2>/dev/null || echo "")
if [ -z "$BRANCH" ]; then
    BRANCH=$(git -C "$CWD" --no-optional-locks rev-parse --short HEAD 2>/dev/null || echo "?")
fi
DIRTY=$(git -C "$CWD" --no-optional-locks diff --name-only 2>/dev/null | wc -l | tr -d ' ')
STAGED=$(git -C "$CWD" --no-optional-locks diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')

GIT_EXTRA=""
if [ "$STAGED" -gt 0 ] 2>/dev/null; then
    GIT_EXTRA=" \033[32m+${STAGED}\033[0m"
fi
if [ "$DIRTY" -gt 0 ] 2>/dev/null; then
    GIT_EXTRA="${GIT_EXTRA} \033[33m~${DIRTY}\033[0m"
fi

# --- Token bar ---
BAR_WIDTH=12
FILLED=$(( USED_PCT * BAR_WIDTH / 100 ))
EMPTY=$(( BAR_WIDTH - FILLED ))
BAR=""
for ((i=0; i<FILLED; i++)); do BAR+="█"; done
for ((i=0; i<EMPTY; i++)); do BAR+="░"; done

if [ "$USED_PCT" -ge 80 ]; then
    PCT_COLOR="\033[31m"
elif [ "$USED_PCT" -ge 50 ]; then
    PCT_COLOR="\033[33m"
else
    PCT_COLOR="\033[32m"
fi

# --- Lines added/removed ---
LINES=""
if [ "$LINES_ADD" -gt 0 ] 2>/dev/null || [ "$LINES_DEL" -gt 0 ] 2>/dev/null; then
    LINES="\033[32m+${LINES_ADD}\033[0m/\033[31m-${LINES_DEL}\033[0m"
fi

# --- Output ---
R="\033[0m"
C="\033[36m"
M="\033[35m"
D="\033[90m"
Y="\033[33m"

MODEL_DISPLAY="${M}${MODEL}${R}"
if [ -n "$CTX_LABEL" ]; then
    MODEL_DISPLAY="${M}${MODEL} ${D}(${CTX_LABEL})${R}"
fi

printf "${MODEL_DISPLAY}  ${C} ${BRANCH}${R}${GIT_EXTRA}  ${PCT_COLOR}${BAR} ${USED_PCT}%%${R}  ${Y}${COST_FMT}${R}"

if [ -n "$LINES" ]; then
    printf "  ${LINES}"
fi

printf "  ${D}${DURATION}${R}"

# --- Write JSON sidecar for programmatic access ---
SIDECAR_DIR="$HOME/.orbit"
mkdir -p "$SIDECAR_DIR" 2>/dev/null
cat > "$SIDECAR_DIR/statusline-latest.json" <<JSONEOF
{"model":"$MODEL","context_pct":$USED_PCT,"cost":$COST,"git_branch":"$BRANCH","dirty":$DIRTY,"staged":$STAGED,"lines_added":$LINES_ADD,"lines_removed":$LINES_DEL,"duration_ms":$DURATION_MS,"context_size":$CTX_SIZE}
JSONEOF
