---
name: tauri-build
description: "Run the full Tauri production build (frontend + Rust native bundle). Use when the user asks to build the app, create a release, or bundle for distribution."
disable-model-invocation: true
argument-hint: ""
---

# Tauri Production Build

Launch a **sub-agent** (Agent tool) to run the full native bundle. This is a long build (2-5 min first run).

## Sub-agent prompt

Use the Agent tool with a timeout of 600000ms:

Run `npm run tauri build` in the project root.
Wait for completion. Report ONLY:
- SUCCESS or FAILURE
- If failed: the FIRST error (max 20 lines) — Rust errors appear after the frontend build
- Build duration

Do NOT paste the full log.
