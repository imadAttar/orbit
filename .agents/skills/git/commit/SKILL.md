# Git Commit — Orbit

Quick conventional commit with auto-staging and push, using project-specific scopes.

## Scopes Orbit

| Scope | Quand |
|-------|-------|
| `ui` | Composants React (App, Sidebar, TabBar, Terminal, etc.) |
| `pty` | Backend PTY/terminal (pty.rs, terminal.rs, Codex.rs) |
| `store` | Zustand store, persistence, types |
| `git` | GitPanel, git.rs, operations git |
| `css` | Styles, themes |
| `ci` | GitHub Actions, workflows |
| `tauri` | Config Tauri, main.rs, lib.rs |
| `i18n` | Traductions, i18n.tsx |
| `test` | Tests unitaires et integration |
| `dx` | Skills, hooks, rules, AGENTS.md |

## Process

1. Run `git status` and `git diff --staged` (stage unstaged changes if needed)
2. Analyze changes and pick the best type + scope from the table above
3. Write commit message: `type(scope): subject` — imperative, < 72 chars, lowercase
4. Run `git commit` then `git push`

## Rules

- Never add `Co-Authored-By` lines
- No emojis in commit messages
- If changes span multiple scopes, use the dominant one or omit scope
- Push after commit unless there are obvious issues
