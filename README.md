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

Orbit wraps Claude Code CLI in a native desktop app. A global project/session sidebar and a central supervision view keep active work and requests for attention visible, while terminals stay accessible. Claude Code remains the engine; Orbit does not replace its agent loop or permission system. Codex is a separate future integration, not part of the current scope.

## Features

- **Session persistence** &mdash; retain the workspace and conversation references for resuming after restart; plain terminals start a new shell
- **Live status indicators** &mdash; see which sessions are working, idle, or waiting for input &mdash; per project, in real time
- **Supervision** &mdash; filter all projects by observed activity or requests for attention, with explicit unknown and stopped states
- **Global navigation** &mdash; switch between projects without killing visited sessions
- **Observed subagents** &mdash; inspect Claude subagent start/stop observations under the owning session; a stop does not prove task success
- **Multi-session per project** &mdash; run several Claude sessions and plain terminals in parallel
- **Prompt navigation** &mdash; jump between prompts in terminal scrollback
- **Local session naming** &mdash; useful titles derived without an additional model request
- **Mode toggle** &mdash; retain Claude's supervised or explicitly selected bypass-permission mode; Orbit does not auto-approve requests

## How it works

Orbit detects session state (working / idle / waiting) through **Claude Code hooks** &mdash; not by parsing terminal output. On first launch, Orbit automatically adds hooks to your project's `.claude/settings.local.json` (the local settings file that isn't committed to git). If the file doesn't exist, it's created.

The hooks publish small per-conversation and per-subagent `~/.orbit/session-*.json` observations atomically. Orbit watches those files and updates the UI in real time. No prompt bodies or tool results are needed for this telemetry. Turning desktop notifications off does not turn session observation off. Hook-configuration failures appear in Supervision with a retry action.

Observation is scoped to the current Orbit execution. It is not a complete replay log: a very short subagent may only be observed after it stops, and a disconnected/stopped process is not reported as successfully completed. Native approval dialogs and the full Claude conversation remain in the session terminal in this version.

> Orbit never modifies your global Claude Code settings (`~/.claude/settings.json`). Only project-local settings are touched. The one exception is the status line script (`~/.claude/statusline.sh`) which Orbit creates on first launch with your permission.

## Download

| Platform | Architecture | Download |
|----------|-------------|----------|
| macOS | Apple Silicon | [Latest .dmg](https://github.com/imadAttar/orbit/releases/latest) |
| Windows | x64 | [Historical release](https://github.com/imadAttar/orbit/releases/tag/v1.0.0) — not rebuilt in the current Mac release |
| Linux | x64 | [Historical release](https://github.com/imadAttar/orbit/releases/tag/v1.0.0) — not rebuilt in the current Mac release |

macOS is the current release focus. Mac builds are ad-hoc signed, not Apple Developer ID signed or notarized. The app's update banner uses the signed `latest.json` feed; see [release and updater verification](docs/RELEASE.md).

### Prerequisites

[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

## Development

Requires Node.js 22.12+ and Rust 1.75+.

```bash
npm install            # Install dependencies
npm run tauri dev      # Launch app in dev mode
npm test               # Run tests
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

[MIT](LICENSE). Third-party dependencies retain their respective licenses.
