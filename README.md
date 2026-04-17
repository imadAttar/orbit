<p align="center">
  <img src="public/orbit-logo.png" alt="Orbit" width="80" />
</p>

<h1 align="center">Orbit</h1>

<p align="center">
  <strong>Desktop app for supervising Claude Code sessions across multiple projects.</strong>
</p>

<p align="center">
  <a href="https://github.com/imadAttar/orbit/releases/latest"><img src="https://img.shields.io/github/v/release/imadAttar/orbit?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/imadAttar/orbit/blob/main/LICENSE"><img src="https://img.shields.io/github/license/imadAttar/orbit?style=flat-square" alt="License" /></a>
  <a href="https://github.com/imadAttar/orbit/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/imadAttar/orbit/build.yml?style=flat-square&label=checks" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platforms" />
</p>

<p align="center">
  <a href="https://github.com/imadAttar/orbit/releases/latest">Download</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#development">Development</a>
</p>

---

## The problem

You run Claude Code in multiple projects. You close the terminal, lose track of which session was doing what. You have no way to know if a background task finished. You restart and can't resume where you left off.

## What Orbit does

Orbit wraps Claude Code CLI in a native desktop app. You keep all your projects open as tabs, resume any session after restart, and get notified when a background session needs attention.

## Features

- **Session persistence** &mdash; close the app, reopen later, resume exactly where you left off
- **Live status indicators** &mdash; see which sessions are working, idle, or waiting for input &mdash; per project, in real time
- **Tab notifications** &mdash; tab flashes when a background session completes
- **Multi-project tabs** &mdash; switch between projects without killing sessions
- **Multi-session per project** &mdash; run several Claude sessions and plain terminals in parallel
- **Prompt navigation** &mdash; jump between prompts in terminal scrollback
- **Auto session naming** &mdash; titles generated via Claude Haiku from your first prompt
- **Mode toggle** &mdash; supervised (asks permissions) or autonomous (runs freely)

## How it works

Orbit detects session state (working / idle / waiting) through **Claude Code hooks** &mdash; not by parsing terminal output. On first launch, Orbit automatically adds hooks to your project's `.claude/settings.local.json` (the local settings file that isn't committed to git). If the file doesn't exist, it's created.

The hooks write state to `~/.orbit/session-state.json`. Orbit watches this file with a native filesystem watcher and updates the UI in real time.

> Orbit never modifies your global Claude Code settings (`~/.claude/settings.json`). Only project-local settings are touched. The one exception is the status line script (`~/.claude/statusline.sh`) which Orbit creates on first launch with your permission.

## Download

| Platform | Architecture | Download |
|----------|-------------|----------|
| macOS | Apple Silicon | [.dmg](https://github.com/imadAttar/orbit/releases/latest) |
| Windows | x64 | [.msi](https://github.com/imadAttar/orbit/releases/latest) |
| Linux | x64 | [.deb / .AppImage](https://github.com/imadAttar/orbit/releases/latest) |

### Prerequisites

[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

## Development

Requires Node.js 20+ and Rust 1.75+.

```bash
npm install            # Install dependencies
npm run tauri dev      # Launch app in dev mode
npm test               # Run tests (171 tests)
npx tsc --noEmit       # Typecheck
npm run tauri build    # Production build for current platform
```

## Architecture

```
src/                    React 19 + TypeScript
  core/                 Zustand store, types, API layer
  features/terminal/    xterm.js terminal + PTY hooks
  layout/               TabBar, Sidebar, StatusBar
  modals/               Preferences, NewProject
  lib/                  Analytics, themes, parsers

src-tauri/src/          Rust backend
  pty.rs                PTY lifecycle (spawn/write/resize/kill)
  claude.rs             CLI integration + session hooks
  watcher.rs            Filesystem watcher for session state
  terminal.rs           Editor integration, scrollback
```

## Tech stack

**Frontend:** React 19, TypeScript, Zustand, xterm.js &middot; **Backend:** Rust, Tauri 2, portable-pty &middot; **Build:** Vite, Cargo &middot; **CI:** GitHub Actions

## Contributing

Contributions welcome. Please [open an issue](https://github.com/imadAttar/orbit/issues) first to discuss what you'd like to change.

## License

[AGPL-3.0](LICENSE)
