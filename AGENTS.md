# Orbit

Tauri 2 desktop app (macOS, Windows, Linux) — React 19 + TypeScript frontend, Rust backend. Wraps Codex CLI via PTY, renders in xterm.js terminals.

## Vision produit

**Orbit != IDE classique.** Interface de supervision autour de l'IA, pas l'IA greffee sur un editeur.
- L'IA est le pilote, l'utilisateur supervise — voir `.Codex/rules/product/vision-guard.md`
- Multi-session, pas d'editeur de code, toute feature doit ameliorer la supervision

## Commands
- `npm run dev` — Vite dev server on localhost:1420
- `npm run build` — TypeScript check + Vite production build
- `npm test` — Run Vitest tests
- `npm run tauri dev` — Full Tauri dev (frontend + native shell)
- `npm run tauri build` — Production Tauri bundle
- `npx tsc --noEmit` — Typecheck only

## Roadmap
See `.Codex/docs/roadmap.md`

## Architecture
- `src/core/` — Store (Zustand), types, API wrappers, persistence
- `src/lib/` — Pure utilities: logger, platform, analytics, themes, parsers
- `src/layout/` — Shell components: TabBar, Sidebar, StatusBar, ContextBar
- `src/features/` — Feature panels: terminal/, UpdateBanner
- `src/modals/` — Modal dialogs: AppModals, PreferencesModal, NewProjectModal
- `src/shared/` — UI primitives: ErrorBoundary, FocusTrap, InlineRename
- `src/hooks/` — App-level hooks (useAppInit, useThemeSync)
- `src/features/terminal/hooks/` — Terminal hooks (usePTY, useScrollback, usePromptNav, useTerminalSearch, useTerminalRestore)
- `src/keyboard/` — Keyboard shortcut handler
- `src/i18n/` — Translations (FR/EN)
- `src/__tests__/` — Tests, mirroring source structure
- `src-tauri/src/` — Rust backend (PTY, Codex, terminal, watcher, Tauri commands)
- `.github/workflows/build.yml` — Check: typecheck + tests on push
- `.github/workflows/release.yml` — Release: build 4 platforms on tag push

## Conventions
- **Cross-platform**: targets macOS, Windows, Linux — see `.Codex/rules/platform/cross-platform.md`
- UI text in French — see `.Codex/rules/frontend/error-messages.md`
- State: Zustand with debounced persistence (300ms) in `core/store.ts`
- PTY-based: Rust spawns Codex CLI, frontend renders via xterm.js
- No CSS framework — plain CSS with BEM — see `.Codex/rules/frontend/css-conventions.md`
- TypeScript strict mode, no direct Anthropic API calls

## References
- Tauri config: `src-tauri/tauri.conf.json`
- Rust deps: `src-tauri/Cargo.toml`
- TS config: `tsconfig.json` | Vite config: `vite.config.ts`
- Persisted data: `~/.orbit/data.json`
