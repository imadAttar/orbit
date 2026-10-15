# Orbit release runbook (v1.1.0)

## Safety boundary

Release workflow creates/updates a **DRAFT ONLY**, never publishes. It rejects an
already-public tag, both before building and immediately before uploading.
There is no automated publish step. A maintainer must independently review the
complete draft before manually publishing. This preparation did not push, commit,
tag, dispatch a workflow, create a release, or change repository secrets.

Always address GitHub explicitly as `-R imadAttar/orbit` (another remote exists).
For `gh api`, which does not support `-R`, use the complete
`repos/imadAttar/orbit/...` endpoint.

## Observed state

Audit of GitHub metadata and public v1.0.0 assets:

- GitHub CLI is authenticated as `imadAttar`; repository/workflow scopes available.
  No credential value is needed or should be printed.
- Repository secret **names only**:
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
  `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID`. No repository variable names returned.
  Presence is not proof that credentials remain valid or policies are approved.
- Latest public release is v1.0.0. Its `latest.json` has a non-empty macOS updater
  signature but **empty Linux and Windows signatures**, and those `.sig` assets
  are absent. It also contains unintended Debian `control.tar.gz`/`data.tar.gz`.
- The public macOS updater was downloaded and cryptographically verified using
  minisign against the **unchanged public key** in `src-tauri/tauri.conf.json`.
  This proves continuity for the existing macOS release, not private-key
  availability for future signing.
- Historical release run 24573556638 succeeded; old step details/logs are gone.
  Latest Check run 28442897940 failed during `npm ci`; its log endpoint returned
  HTTP 410, so the exact old install error cannot be established from logs.
- Old CI used Node 25, excluded by current Vitest 5 engines. CI now uses supported
  Node 22 LTS. Node 22.23.1/npm 10.9.8 were used for local verification.
- WDIO 9's 19 high development advisories were removed by upgrading its five
  direct packages to compatible WDIO 10 releases (no blanket transitive
  overrides). `npm ci` succeeds and `npm audit --audit-level=high` reports zero
  vulnerabilities, including dev dependencies. WDIO 10's actual config parser
  discovered both existing specs, and its Mocha framework and spec reporter
  imported successfully. Full native WDIO E2E needs a
  supported tauri-driver platform (Linux/Windows); macOS cannot prove that suite.

## Updater signing versus OS code signing

**Do not generate, rotate, print or retrieve the production updater private key.**
The current public key is the trust anchor for existing installed apps. Actions
receives the existing private key/password exclusively through secret environment
bindings. The helper reads only the repository public key and public `.sig`
files. Tests use disposable temporary fixture keys, unrelated to production.

Every release must include updater payloads/signatures for exactly:

| Updater platform | Payload | Sidecar |
| --- | --- | --- |
| `darwin-aarch64` | `Orbit_aarch64-apple-darwin.app.tar.gz` | `.app.tar.gz.sig` |
| `linux-x86_64` | `Orbit_<version>_amd64.AppImage` | `.AppImage.sig` |
| `windows-x86_64` | `Orbit_<version>_x64_en-US.msi` | `.msi.sig` |

macOS Intel is not built and must not be advertised. Installers additionally
include the Apple Silicon `.dmg` and Linux `.deb`. No Debian internal tarballs or
unbuilt NSIS payloads are collected. All five installers/payloads are mandatory.

OS trust is separate:

- macOS uses the existing ad-hoc signing identity. It is **not Developer ID signed
  or notarized**; Gatekeeper warnings remain possible.
- Both SignPath secret names exist in the audited repository, so Windows requests
  SignPath signing. The fixed action input is `github-artifact-id`, not the old,
  unsupported `github-artifact-name`. Actual SignPath authentication/policy state
  cannot be established from secret-name metadata alone.
- If both SignPath secrets are absent, Authenticode signing is skipped with an
  explicit warning; the MSI and release notes are labeled **UNSIGNED**, not signed.
  A partial configuration fails. A configured SignPath request failure is NOT
  silently bypassed. Resolve approval/policy failures rather than shipping falsely
  labeled output.
- SignPath changes MSI bytes. The workflow validates Authenticode, replaces the
  MSI, and **re-signs those final bytes for the updater using the existing key**.
  The final Linux verification job validates all three updater signatures against
  the public key. This catches stale pre-SignPath `.msi.sig` files.
- `SIGNING-STATUS.txt` is included in assets, release notes, and checksums.

## Prerequisites and local gates

Python 3.11+, minisign (`brew install minisign` on macOS;
`sudo apt-get install minisign` on Ubuntu), Node 22.19+ on the Node 22 LTS line,
Rust stable with rustfmt/clippy, native Tauri build prerequisites.

```sh
npm ci
npm run lint                    # TypeScript strict/no-unused checks (not ESLint)
npm audit --audit-level=high     # full tree, including development tools
npm test
npm run build
npm run test:release            # real minisign fixture verification + negatives
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
actionlint .github/workflows/build.yml .github/workflows/release.yml
```

UI/source edits are owned by other agents; transient failures during parallel
integration are not a reason to weaken these gates or skip tests. Re-run all
checks on the final integrated tree before approval.

Before tagging, the parent must coordinate the 1.1.0 version bump in `package.json`,
`package-lock.json` (top-level and root package), `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and Orbit's entry in `src-tauri/Cargo.lock`.
This task intentionally does not independently change Rust/config versions.

```sh
python3 scripts/release.py check-version --tag v1.1.0
```

The workflow preflight enforces this equality before any release build.
The reusable Check workflow gates frontend build/typecheck/tests/audit/helper
regressions plus Rust fmt, warnings-as-errors clippy and tests on all three OSes.
Release matrix builds macOS arm64 (`macos-15`, explicitly listed as arm64 in the
current actions/runner-images catalogue; macOS 14 is deprecated), Windows x64 and
Linux x64 with explicit targets and installer types.

## Independent verification of a future draft

Only after the maintainer authorizes tag/push/build (not performed here):

1. Inspect the Release run and each platform job. In particular review actual
   SignPath result/Authenticode validation; secret presence alone is insufficient.
2. Download the draft assets into a new directory (avoid stale assets):

   ```sh
   gh release view v1.1.0 -R imadAttar/orbit --json isDraft,assets
   gh release download v1.1.0 -R imadAttar/orbit --dir /tmp/orbit-v1.1.0-review
   python3 scripts/release.py verify --output /tmp/orbit-v1.1.0-review --tag v1.1.0 --repo imadAttar/orbit
   ```

3. The helper requires all five expected installers/payloads and all three
   signature sidecars, correct architecture/version names, exactly three updater
   platforms, exact GitHub URLs, non-empty cryptographically valid updater
   signatures against the existing key, and SHA256 coverage/content for every
   asset (including `latest.json` and signing-status text). It rejects duplicate
   basenames, unsafe/unexpected assets, orphan signatures, and tampering.
   `SHA256SUMS` covers everything except itself; it is an integrity manifest, not
   a substitute for updater signatures or an independently signed attestation.
4. Independently install/smoke-test each native platform, verify startup/terminal/
   resume/activity/settings, and exercise an actual update from the previously
   installed app. The v1.0.0 Linux/Windows missing signatures are historical
   defects; v1.1.0 must not repeat them. A draft's update URLs are not public, so
   public updater download testing requires a controlled staging feed or the
   explicit publication decision; do not publish just to test.
5. Confirm `isDraft: true`, inspect changelog/signing warnings and checksums, and
   hand off evidence to the parent reviewer. Publication is a separate manual
   decision. Check the final asset list for stale assets left by an earlier draft
   attempt; the strict verification helper rejects unexpected leftovers.

No Windows/Linux native release builds or live SignPath requests can be proved
locally on macOS without running Actions; do not claim they ran merely because
workflow syntax and fixture tests pass.
