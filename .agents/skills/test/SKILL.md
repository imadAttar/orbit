---
name: test
description: "Run Vitest tests. Use when the user asks to run tests, check tests, or verify test suite."
disable-model-invocation: true
argument-hint: "[test file or pattern]"
---

# Run Tests

Launch a **sub-agent** (Agent tool) to run tests. This keeps verbose output out of the main context.

## Sub-agent prompt

Use the Agent tool with a timeout of 120000ms:

**Command logic:**
- No arguments → `npm test`
- With argument → `npm test -- $ARGUMENTS`

Run in the project root.
Wait for completion. Report ONLY:
- SUCCESS or FAILURE
- If failed: failing test name + first error (max 20 lines)
- Test duration and count (X passed, Y failed)

Do NOT paste the full output.
