# CI Debug

Diagnostique automatique des echecs CI.

## Usage
`/ci-debug` — diagnostique le dernier echec CI
`/ci-debug <run-id>` — diagnostique un run specifique

## Steps

1. **Fetch latest failed run**:
   - If no run ID provided: `gh run list --repo imadAttar/orbit --status failure --limit 1`
   - Get run ID from output

2. **Get failure details**:
   - `gh run view <run-id> --repo imadAttar/orbit` for overview
   - `gh run view <run-id> --repo imadAttar/orbit --log-failed` for error logs

3. **Analyze the failure**:
   - Categorize: build error / test failure / CI config / dependency / timeout
   - Identify the root cause from logs
   - Check if the error is platform-specific (macOS/Linux/Windows)

4. **Propose fix**:
   - Show the exact error
   - Suggest a concrete fix
   - If it's a known pattern (icon missing, Node version, action version), fix it directly

5. **Optionally apply fix**: ask the user if they want to apply the fix and push
