---
name: build
description: "Run the frontend build (TypeScript check + Vite). Use when the user asks to build, compile, or check for TypeScript errors."
disable-model-invocation: true
argument-hint: ""
---

# Frontend Build

Launch a **sub-agent** (Agent tool) to run the build. This keeps verbose output out of the main context.

## Sub-agent prompt

Use the Agent tool with a timeout of 180000ms:

Run `npm run build` in the project root.
Wait for completion. Report ONLY:
- SUCCESS or FAILURE
- If failed: the FIRST error (max 20 lines)
- Build duration

Do NOT paste the full log.
