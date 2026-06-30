# Oneshot

Ultra-fast feature implementation — Explore then Code then Test.

## Usage

```
/oneshot <feature description>
```

## Process

1. **Explore** (~30s) — Identify the files to touch:
   - Grep/Glob for related code in `src/` and `src-tauri/src/`
   - Read the relevant files
   - Check `.Codex/rules/` for applicable conventions

2. **Code** — Implement the change:
   - Edit existing files (prefer Edit over Write)
   - Follow cross-platform rules if touching Rust
   - Follow vision-guard: only if it improves AI supervision

3. **Verify** — Run checks in parallel:
   - `npx tsc --noEmit` — typecheck
   - `npm test` — unit tests
   - If Rust changed: `cargo check` + `cargo clippy`

4. **Fix** — If checks fail, fix and re-verify (max 2 iterations)

5. **Summary** — One-line description of what was done + files touched

## Rules

- No new dependencies without asking
- No new files unless strictly necessary
- If the feature violates vision-guard.md, stop and explain why
- Max scope: 1-3 files changed. If more needed, switch to a plan
