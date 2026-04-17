<p align="center">
  <img src="public/orbit-logo.png" alt="Orbit" width="80" />
</p>

<h1 align="center">Orbit</h1>

<p align="center">
  Terminal interface for supervising Claude Code sessions across multiple projects.
</p>

<p align="center">
  <a href="https://github.com/imadAttar/orbit/releases">Download</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#development">Development</a>
</p>

---

## What is Orbit?

Orbit wraps Claude Code CLI in a desktop app that lets you manage multiple AI coding sessions and pick them back up after closing the app. Each project gets real-time status indicators so you know at a glance which sessions are working, waiting for input, or idle.

## Features

- **Session persistence** &mdash; close the app, reopen it, resume exactly where you left off
- **Per-project status notifications** &mdash; live indicators (working / idle / waiting) via Claude Code hooks, with tab flash when a background session completes
- **Multi-project tabs** &mdash; switch between projects without killing sessions
- **Multi-session per project** &mdash; run several Claude sessions and plain terminals in parallel
- **Prompt navigation** &mdash; jump between prompts in terminal scrollback
- **Mode toggle** &mdash; supervised (permission prompts) or autonomous
- **Auto session naming** &mdash; session titles are generated via Claude Haiku using your active Claude Code session

## How notifications work

Orbit monitors session state (working / idle / waiting) through Claude Code hooks. On first launch or when creating a new project, Orbit automatically adds the required hooks to your project's `.claude/settings.local.json`. This file is local to each project and is not committed to git.

The hooks write session state to `~/.orbit/session-state.json`, which Orbit watches in real time to update the UI indicators.

> **Note:** Orbit never modifies your global Claude Code settings (`~/.claude/settings.json`). Only project-local settings are touched. The one exception is the status line script (`~/.claude/statusline.sh`) which Orbit creates on first launch with your permission.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [.dmg](https://github.com/imadAttar/orbit/releases/latest) |
| macOS (Intel) | [.dmg](https://github.com/imadAttar/orbit/releases/latest) |
| Windows | [.msi](https://github.com/imadAttar/orbit/releases/latest) |
| Linux | [.deb / .AppImage](https://github.com/imadAttar/orbit/releases/latest) |

## Development

Requires Node.js 20+ and Rust 1.75+.

```bash
npm install            # Install dependencies
npm run tauri dev      # Launch app in dev mode
npm test               # Run tests
npx tsc --noEmit       # Typecheck
```

### Building

```bash
npm run tauri build    # Production build for current platform
```

## Architecture

```
src/                    React 19 + TypeScript frontend
  core/                 Zustand store, types, API wrappers
  features/terminal/    xterm.js terminal with PTY hooks
  layout/               TabBar, Sidebar, StatusBar
  modals/               Preferences, NewProject
  lib/                  Analytics, themes, parsers
src-tauri/src/          Rust backend
  pty.rs                PTY spawn/write/resize/kill
  claude.rs             Claude CLI integration
  watcher.rs            File watcher for session state
  terminal.rs           Editor integration, scrollback
```

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[AGPL-3.0](LICENSE)
