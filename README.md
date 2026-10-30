<p align="center">
  <img src="public/orbit-logo.png" alt="Orbit" width="80" />
</p>

<h1 align="center">Orbit</h1>

<p align="center">
  <strong>A desktop workspace for Claude Code: projects, sessions, supervision and previews.</strong>
</p>

<p align="center">
  <a href="https://github.com/imadAttar/orbit/releases/latest"><img src="https://img.shields.io/github/v/release/imadAttar/orbit?style=flat-square" alt="Published release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/imadAttar/orbit/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/imadAttar/orbit/build.yml?branch=main&style=flat-square&label=checks" alt="Main branch checks" /></a>
  <img src="https://img.shields.io/badge/release%20focus-macOS%20Apple%20Silicon-blue?style=flat-square" alt="Release focus: macOS Apple Silicon" />
</p>

<p align="center">
  <a href="#download">Download</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#development">Development</a>
</p>

## What Orbit does

Orbit wraps the Claude Code CLI in a Tauri desktop app. Keep several projects and sessions open, see which ones need attention, and preview files or web pages beside the terminal.

**Claude Code remains the engine.** Its conversation, commands, permission prompts and terminal output stay native. Orbit adds navigation and observation around it, not a replacement agent loop or a reconstructed chat interface. Codex is not integrated in the current version.

## Current status

- **Source on `main`: 1.2.1.** The features below describe this source version.
- **Latest published download: v1.0.0.** The 1.2.1 installer has not been published yet; downloading the latest public release does not include all changes described below.
- **Next binary release: macOS Apple Silicon only.** Windows and Linux remain source/CI targets, but no new installers for those platforms are announced here. There is no new Intel Mac build.

## Features

- **Projects and sessions** — a global sidebar, multiple Claude sessions and plain terminals per project, pinned sessions, and navigation without terminating visited sessions.
- **Workspace persistence** — save projects, session metadata, terminal scrollback and Claude conversation references for restoration. Restarting Orbit does not preserve the original OS processes; plain terminals start a new shell.
- **Supervision** — filter sessions across projects by observed activity or requests for attention, with explicit unknown and stopped states.
- **Observed subagents** — see Claude subagent start/stop observations under their owning session. An observed stop is not proof of task success.
- **Read-only previews** — a collapsible, resizable panel for web pages, Markdown, source/text files and raster images. Browse registered project files or select an exact file through the native picker.
- **Terminal tools** — search, zoom and prompt navigation without replacing the Claude terminal. Session titles are derived locally without an additional model request.
- **Themes** — nine palettes applied to the app chrome, terminals and local preview surfaces, including preference previews and cancellation. External websites, images and native OS dialogs retain their own appearance.
- **Notifications** — report observed requests for attention and completion, including deferred parent completion while known subagents are still active. Disabling notifications does not disable observation.
- **Explicit permission modes** — normal Claude permissions remain available; bypass-permission mode is an explicit user choice. Orbit does not automatically approve requests.
- **Update checks** — the 1.2.1 source checks at startup, periodically every six hours, and when the app becomes visible again if a check is due, subject to update preferences. No forced restart.

## How it works

### Native terminals and observation

React and xterm.js display real PTY sessions managed by the Rust backend. Session activity comes from **official Claude Code hooks**, not inference from terminal output.

Orbit installs observation hooks in each project's `.claude/settings.local.json`, preserving unrelated settings. The hook producer atomically writes small per-conversation and per-subagent `~/.orbit/session-*.json` observations. No prompt bodies or tool results are needed for this telemetry. Hook-configuration failures are visible in Supervision with a retry action.

Observation is scoped to the current execution, not a complete replay log. A very short subagent may first be observed after it stops; a disconnected or stopped process is not reported as successfully completed. Claude's full conversation and approval prompts remain in the terminal.

An optional status-line integration can create `~/.claude/statusline.sh`; it is separate from project-local observation hooks.

### Preview boundaries

Local previews are read-only. Access is limited to registered project roots or an exact file selected through the native picker. Canonical path checks reject traversal and existing symlink escapes; they are not a sandbox against a hostile local process racing filesystem changes.

Web pages load separately from the privileged app UI. Some sites refuse embedding and must be opened in an external browser. PDF preview is not implemented. External content is not recolored by Orbit themes.

### Updates and signing

The updater reads `latest.json` to discover a release. **The manifest itself is unsigned; the update payload is signed and verified with the existing updater public key.** Downloaded release artifacts must pass signature and checksum checks before publication.

macOS packaging uses **ad-hoc code signing**, not Apple Developer ID signing or notarization. Gatekeeper warnings may appear. Updater signatures and Apple notarization are different mechanisms. See the [release runbook](docs/RELEASE.md) for the draft-first workflow and verification gates.

## Download

The currently published installers are from **v1.0.0**, not the 1.2.1 source revision:

| Platform | Architecture | Published download |
|----------|--------------|--------------------|
| macOS | Apple Silicon | [v1.0.0 DMG](https://github.com/imadAttar/orbit/releases/download/v1.0.0/Orbit_1.0.0_aarch64.dmg) |
| Windows | x64 | [v1.0.0 MSI](https://github.com/imadAttar/orbit/releases/download/v1.0.0/Orbit_1.0.0_x64_en-US.msi) |
| Linux | x64 | [v1.0.0 AppImage and DEB](https://github.com/imadAttar/orbit/releases/tag/v1.0.0) |

Check [GitHub Releases](https://github.com/imadAttar/orbit/releases) for published binaries. Finish running tasks before replacing or restarting the app. Keep a backup of your workspace and Claude conversations.

### Prerequisite for using Orbit

Install and authenticate the [Claude Code CLI](https://code.claude.com/docs/en/setup). Orbit is a wrapper, not a bundled replacement for Claude Code or its account/subscription.

## Development

- **Node.js:** use `nvm use` with the checked-in `.nvmrc` (Node 24). The manifest supports `^22.19.0 || ^24.0.0 || >=26.0.0`; CI currently uses Node 22.
- **Rust:** use a current stable toolchain through rustup. Local native checks have been exercised with Rust 1.94.0; Rust 1.75 is not a supported baseline for the current dependency graph.
- **Native dependencies:** install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform, including Xcode Command Line Tools on macOS.

```bash
npm ci                         # Install the locked JavaScript dependencies
npm run tauri -- dev            # Launch the native app in development
npm test                       # Frontend unit/integration tests
npm run lint                   # TypeScript checking (not ESLint)
npm run build                  # Build web assets only, not a native installer
npm run test:release            # Release helper regression tests

cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

npm run tauri -- build          # Local native build for the host platform
```

Production updater signing uses the existing GitHub Actions secrets. Do not commit private keys, credentials or local QA reports. Local builds are not automatically published releases.

Pull requests run the frontend/typecheck/build and release-helper checks. The native Mac/Windows/Linux matrix is reserved for release tags or explicit manual runs; a green PR check does not establish native Windows validation. Packaging and public availability require the separate release gates.

## Architecture

```text
src/                         React + TypeScript
  core/                      Zustand state, persistence, supervision and API layer
  features/terminal/         xterm.js terminals and PTY hooks
  features/supervision/      Session supervision and observed subagents
  features/preview/          Web/file preview panel and state
  features/updater.ts        Update checking and installation flow
  layout/                    Sidebar, tabs, status and terminal toolbar
  modals/                    Preferences and project dialogs
  lib/                       Themes, logging and shared utilities

src-tauri/src/               Rust backend
  pty.rs                     PTY lifecycle and bounded input delivery
  claude.rs                  Claude CLI integration and observation hooks
  preview.rs                 Scoped read-only files and preview commands
  watcher.rs                 Filesystem observation
  terminal.rs                Editor integration and scrollback

scripts/release.py           Release asset collection and verification
.github/workflows/           Checks and draft-only Mac release pipeline
```

**Stack:** React 19, TypeScript, Zustand, xterm.js, Rust, Tauri 2, portable-pty, Vite and Cargo.

## Contributing

Please [open an issue](https://github.com/imadAttar/orbit/issues) to discuss significant changes. Keep Claude's native behavior intact, add regression tests for fixes, and keep machine-specific agent settings, audit evidence and credentials out of Git.

## License

[MIT](LICENSE). Third-party dependencies retain their respective licenses. Historical releases retain the license notices shipped with their distributions.
