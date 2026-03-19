# Orbit -- Product Audit Report (2026-03-24)

## Executive Summary

Orbit is a well-built Tauri 2 desktop app (~8.2K LOC frontend, ~1.5K LOC Rust) with clean code, no TODOs, and a lean dependency tree. The core architecture (PTY-based Claude Code CLI wrapper) is sound. However, the audit reveals **2 critical**, **5 high**, **4 medium security**, and several performance/architecture issues that should be addressed.

### Health Scorecard

| Domain | Grade | Notes |
|--------|-------|-------|
| Code Quality | B | Clean code, but App.tsx god component (1.2K LOC) needs decomposition |
| Security | B+ | No critical vulns, good CSP/capabilities, minor path validation gaps |
| Performance | B | Efficient keystroke path, but store selector + scrollback IO issues |
| Architecture | B- | Monolithic App.tsx + store.ts approaching maintenance ceiling |
| Test Coverage | C | 145 tests pass, but ~60% of components have 0% coverage |
| UX/Accessibility | C+ | Good keyboard shortcuts, but missing focus trapping + aria labels |

---

## Phase 1: Technical Audit

### 1.1 Code Quality

#### CRITICAL

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Mutex poisoning risk -- if PTY reader thread panics, all subsequent `lock()` calls fail, bricking the app | `pty.rs:375` | App becomes unusable until restart |
| 2 | `unwrap()` in command handler -- `path.parent().unwrap()` can panic on root path, crashing the backend | `pty.rs:569` | Backend crash |

#### HIGH

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 3 | App.tsx is a god component (1,211 LOC) -- 16+ useState, 7 useEffect, 6 useCallback, 23 store selectors, 6 inline modals | `App.tsx:422-1211` | Every store change re-renders entire tree |
| 4 | Stale closure risk -- keyboard useEffect has `[]` deps but callbacks capture initial closures | `App.tsx:637-650` | Shortcuts may operate on stale state |
| 5 | Fragile `setTimeout` for PTY readiness -- 500ms and 2000ms arbitrary delays | `App.tsx:576,587` | Breaks on slow machines |
| 6 | Monolithic Terminal effect (270 LOC) -- creates xterm, loads addons, spawns PTY, sets up listeners. Any dep change tears down everything | `Terminal.tsx:173-441` | Race conditions on teardown |
| 7 | `sendFromCoach` relies on 50ms delay for Ctrl+U processing | `App.tsx:622-634` | Can send prompt before line is cleared |

#### MEDIUM

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 8 | ~100 LOC dead CSS (`.input-bar` section never used) | `styles.css:1985-2167` | Bundle bloat |
| 9 | Undefined CSS custom properties (`--bg-hover`, `--bg-active`, `--bg-alt`, `--accent-rgb`) | `styles.css` various | Declarations silently have no effect |
| 10 | `extractCost` exported but never imported -- Terminal.tsx re-implements inline | `terminalParser.ts` / `Terminal.tsx:326` | Duplicated logic |
| 11 | `persist()` creates full state snapshot on every mutation including transient fields | `store.ts:248-256` | Wasteful object allocation |
| 12 | ErrorBoundary has hardcoded French strings (class component, can't use i18n hook) | `ErrorBoundary.tsx:29-30` | Breaks i18n |
| 13 | No validation on `fontSize` bounds in store (UI constrains to 8-20 but store accepts any number) | `store.ts:515-520` | Can persist invalid values |
| 14 | Race: `removeProject` does async PTY cleanup after state update | `store.ts:336-343` | Old PTY events can arrive for new sessions |

#### LOW

| # | Issue | Location |
|---|-------|----------|
| 15 | Dynamic `import("@tauri-apps/api/core")` repeated 15+ times | App.tsx, Terminal.tsx |
| 16 | `!important` on xterm-screen height (no comment explaining why) | `styles.css:617` |
| 17 | No focus trapping in modals -- Tab escapes to background | All modals |
| 18 | Inline style objects created in render path | `App.tsx:1068,1108,1137` |
| 19 | Missing `aria-label` on icon-only buttons | `App.tsx:726-754` |
| 20 | Google Fonts loaded from CDN -- fails offline | `styles.css:1` |

#### TypeScript Error (Active)

| # | Issue | Location |
|---|-------|----------|
| TS1 | `"session.working"` not assignable to i18n key type -- missing translation key | `App.tsx:877` |

---

### 1.2 Security Audit

**No critical or high severity vulnerabilities found.**

#### MEDIUM

| # | Issue | Location | Risk |
|---|-------|----------|------|
| S1 | `withGlobalTauri: true` exposes IPC to devtools -- XSS could invoke any Tauri command | `tauri.conf.json:34` | XSS amplification |
| S2 | `cmd.exe` metacharacters (`>`, `<`, `(`, `)`) not blocked in `validate_dir` | `terminal.rs:86-114` | File overwrite via redirect |
| S3 | `git_diff_file` accepts unvalidated file paths -- `../../` possible | `git.rs:49` | Path traversal |
| S4 | `git_commit` accepts arbitrary file paths for staging | `git.rs:62-83` | Stage files outside project |

#### LOW

| # | Issue | Location |
|---|-------|----------|
| S5 | `create_directory` uses string comparison for home check instead of `canonicalize()` | `terminal.rs:449-472` |
| S6 | Inconsistent session ID validation (some commands validate, some don't) | `pty.rs` various |
| S7 | `portable-pty 0.8` is aging (2023) | `Cargo.toml` |
| S8 | PTY working directory not canonicalized before spawn | `pty.rs:165` |

#### POSITIVE FINDINGS

- CSP well-configured (no `unsafe-eval`, no `unsafe-inline` for scripts)
- Capabilities tightly scoped (FS restricted to `$HOME/.orbit/**`)
- Auto-updater uses signed updates with public key verification
- PTY environment uses explicit allowlist (not full inheritance)
- `read_file` has proper canonicalize + starts_with path traversal guard
- No hardcoded secrets (Aptabase key is a client-side app key, not a secret)
- Analytics data is minimal (event names + app version, no PII)

---

### 1.3 Performance

#### P1 (Fix Now)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| P1 | `diff2html` is a dead dependency (2.3 MB, never imported) | `package.json:37` | Wasted disk, potential bundle bloat |
| P2 | `useStore((s) => s.settings)` selects entire object -- sidebar drag causes full App re-render per pixel | `App.tsx:427` | UI jank during resize |

#### P2 (Fix This Month)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| P3 | Mutex held during PTY write IO -- blocks all sessions | `pty.rs:386-399` | Write latency under load |
| P4 | Scrollback serialization every 10s per terminal (5 terminals = 5 disk writes/10s) | `Terminal.tsx:410` | IO churn |
| P5 | `read_file` has no size limit (can OOM on 50MB log file) | `terminal.rs:347-368` | Memory spike |
| P6 | `resolve_claude_path()` calls subprocess every spawn (not cached) | `pty.rs:42-81` | Spawn latency |

#### P3 (Schedule)

| # | Issue | Location |
|---|-------|----------|
| P7 | Extract App.tsx into 6-8 components (modals, TabBar, Sidebar) | `App.tsx` |
| P8 | 23 individual store selectors in App (noisy, could group) | `App.tsx:424-446` |
| P9 | Repeated `await import("@tauri-apps/api/core")` -- create cached helper | Multiple files |
| P10 | Bundle fonts locally instead of CDN (offline resilience) | `styles.css:1` |

---

### 1.4 Test Coverage

**145 tests, 9 files, all passing.**

#### Coverage Map

| Source File | Coverage | Verdict |
|---|---|---|
| `keyboardHandler.ts` | ~95% | Excellent |
| `terminalParser.ts` | ~95% | Excellent |
| `diffParser.ts` | ~95% | Excellent |
| `themes.ts` | ~90% | Good |
| `analytics.ts` | ~85% | Good |
| `platform.ts` | ~80% | Good |
| `store.ts` | ~35% | Partial -- 65% of actions untested |
| `Terminal.tsx` | ~20% | Low -- most behavior untested |
| `App.tsx` | ~2% | Critical gap |
| `CommandPalette.tsx` | 0% | Not tested |
| `GitPanel.tsx` | 0% | Not tested |
| `DiffViewer.tsx` | 0% | Not tested |
| `FileViewer.tsx` | 0% | Not tested |
| `ChangedPanel.tsx` | 0% | Not tested |
| `SplitPane.tsx` | 0% | Not tested |
| `ErrorBoundary.tsx` | 0% | Not tested |
| `ContextBar.tsx` | 0% | Not tested |
| `PromptCoach.tsx` | 0% | Not tested |
| `updater.ts` | 0% | Not tested |

#### Test Quality Issues

1. **Fragile async** -- `terminal.integration.test.ts` uses `flushAsync()` loop (30x setTimeout heuristic) + extra 100ms sleep
2. **Over-mocking** -- Terminal tests replace entire store with static mock, never validates real store actions
3. **`helpers.test.ts`** copies `prevDirName` implementation instead of importing it
4. **No persistence verification** in store tests (never asserts `writeTextFile` was called)
5. **No error path tests** for store init with corrupted JSON, scrollback save failure, updater network errors

#### High Priority Test Gaps

1. Store persistence layer (scrollback, data save/load, migration, session ID validation)
2. `updater.ts` state machine (users depend on auto-update working)
3. `ErrorBoundary.tsx` (safety net for the entire app)
4. Remaining store actions (bookmarks, split, git state, notifications)
5. `CommandPalette.tsx` keyboard navigation
6. `GitPanel.tsx` commit/push flow with error handling

---

## Phase 2: UX Audit (Code-Based)

### Accessibility

| Issue | Severity | Location |
|-------|----------|----------|
| No focus trapping in modals (Tab escapes to background) | High | All modal components |
| Missing `aria-label` on icon-only buttons (+, star, delta) | Medium | `App.tsx:726-754` |
| Google Fonts fail offline (render delay) | Medium | `styles.css:1` |
| ErrorBoundary not internationalized | Low | `ErrorBoundary.tsx` |
| No `prefers-reduced-motion` media query for animations | Low | `styles.css` |
| No `prefers-color-scheme` support (manual theme only) | Info | `themes.ts` |

### UX Patterns

| Pattern | Quality | Notes |
|---------|---------|-------|
| Keyboard shortcuts | Good | Comprehensive, well-tested, platform-aware (Cmd/Ctrl) |
| Terminal rendering | Good | xterm.js 6.0, proper fit/resize, scrollback persistence |
| Theme system | Good | 8 themes, consistent token application |
| i18n | Good | French + English, dynamic switching |
| Drag & drop reorder | Present | Sessions reorderable in sidebar |
| Split pane | Present | Two terminals side-by-side, resizable |
| Command palette | Present | Bookmarks + skills, keyboard navigable |
| Auto-update | Present | Signed updates, progress tracking |
| Error recovery | Weak | ErrorBoundary exists but basic (no error reporting, hardcoded FR) |
| Onboarding | Basic | First-run creates project, statusline prompt |

---

## Phase 3: Product Metrics

**Not applicable** -- Orbit is a desktop app in early development (v0.1.0). No analytics dashboard, no retention data, no funnel to analyze. Aptabase telemetry collects basic event counts only.

**Recommendation**: When ready, add activation metrics (first session created, first Claude response seen, first diff reviewed) to understand the onboarding funnel.

---

## Phase 4: Prioritized Action Plan

### NOW (This Week) -- P0

| # | Action | Domain | Effort | Why |
|---|--------|--------|--------|-----|
| 1 | Fix `unwrap()` in `create_statusline` (`pty.rs:569`) | Rust | S | Backend crash on edge case |
| 2 | Fix TS error: `"session.working"` missing from i18n keys | TS | S | Build breaks |
| 3 | Remove `diff2html` dependency (`npm uninstall diff2html`) | Build | S | 2.3 MB dead weight |
| 4 | Set `withGlobalTauri: false` for production | Security | S | XSS amplification vector |
| 5 | Fix `useStore((s) => s.settings)` -- select individual fields | Perf | S | UI jank on sidebar resize |

### NEXT (This Month) -- P1

| # | Action | Domain | Effort | Why |
|---|--------|--------|--------|-----|
| 6 | Add `>`, `<`, `(`, `)`, `!` to `validate_dir` blocklist | Security | S | cmd.exe injection gap |
| 7 | Add path traversal validation to `git_diff_file` and `git_commit` | Security | S | Path escape risk |
| 8 | Switch to `parking_lot::Mutex` (no poisoning) or handle poisoned locks | Rust | M | App reliability |
| 9 | Add size limit to `read_file` (1 MB cap) | Rust | S | OOM prevention |
| 10 | Increase scrollback save interval to 30-60s | Perf | S | Reduce IO churn |
| 11 | Cache `resolve_claude_path()` result | Perf | S | Faster spawn |
| 12 | Remove dead CSS (`.input-bar`, unused selectors) | CSS | S | Cleanup |
| 13 | Define missing CSS custom properties (`--bg-hover`, `--bg-active`, `--bg-alt`, `--accent-rgb`) | CSS | S | Fix invisible styles |
| 14 | Add store persistence tests + error path tests | Test | M | Catch regressions |

### LATER (This Quarter) -- P2

| # | Action | Domain | Effort | Why |
|---|--------|--------|--------|-----|
| 15 | Extract App.tsx into components (TabBar, Sidebar, 6 modals) | Architecture | L | Maintainability + perf |
| 16 | Break Terminal.tsx main effect into smaller effects | Architecture | M | Reduce teardown scope |
| 17 | Add focus trapping to all modals | A11y | M | Keyboard accessibility |
| 18 | Add aria-labels to icon buttons | A11y | S | Screen reader support |
| 19 | Bundle Google Fonts locally | UX | S | Offline resilience |
| 20 | Add tests for 0% coverage components (CommandPalette, GitPanel, DiffViewer) | Test | L | Coverage gaps |
| 21 | Create cached `getTauriCore()` helper | DX | S | Reduce boilerplate |
| 22 | Centralize session ID validation | Security | S | Consistency |

### ACCEPT (Low Impact, Not Worth Fixing Now)

- `styles.css` monolith (2.3K LOC) -- works fine, split when it grows
- `store.ts` single store -- Zustand handles this size well
- `!important` on xterm-screen -- needed to override xterm defaults
- `portable-pty 0.8` age -- no CVEs, works correctly

---

## Reaudit Recommendation

Schedule reaudit in **90 days** (2026-06-22). Focus areas:
1. Verify all P0/P1 items are resolved
2. Re-run security audit after `validate_dir` and path traversal fixes
3. Measure test coverage with `vitest --coverage` (target: 60% overall)
4. Review any new components added since this audit
