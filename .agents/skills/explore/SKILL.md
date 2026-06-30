# Explore

Deep exploration of codebase, docs, and web for any topic or question.

## Usage

```
/explore <topic or question>
```

## Process

1. **Parse the query** — identify what the user wants to understand (component, pattern, flow, architecture decision, etc.)

2. **Search the codebase** — use Glob, Grep, Read across both layers:
   - `src/` — React frontend (components, store, styles, platform utils)
   - `src-tauri/src/` — Rust backend (PTY, git, terminal, Tauri commands)
   - `.Codex/` — rules, skills, hooks, docs

3. **Search docs** — check `.Codex/docs/` (architecture.md, roadmap.md) for high-level context

4. **Search web if needed** — use Context7 or WebSearch for external library docs (Tauri, xterm.js, Zustand, etc.)

5. **Synthesize** — present findings concisely:
   - Where the relevant code lives (file:line)
   - How it works (data flow, key functions)
   - Cross-platform considerations if applicable
   - Related patterns elsewhere in the codebase

## Rules

- Never modify code — this is a read-only exploration skill
- Start with the most likely location, expand if needed
- For Rust: check `lib.rs` for command registration, then individual modules
- For React: check `App.tsx` for component tree, then individual components
- For state: check `store.ts` for Zustand store shape
- Always mention if something touches both frontend and backend (IPC boundary)
