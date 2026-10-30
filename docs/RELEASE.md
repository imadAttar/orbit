# Orbit release runbook — macOS Apple Silicon

## Scope and publication gate

The tag workflow builds a macOS Apple Silicon DMG and updater payload. It creates a **draft only**, after frontend/native CI, signature verification and checksum coverage succeed. Publishing requires explicit maintainer authorization and an independent download/verification of the draft. Never alter an already-public release or reuse an existing tag.

Use `imadAttar/orbit` explicitly for every GitHub operation; another upstream remote exists. Windows/Linux remain source targets and CI targets, but are not advertised as new binaries in this macOS release. The helper still defaults to requiring all platforms; Mac-only workflows must explicitly select `--platforms macos-arm64`.

## Signing continuity

- Never generate, rotate, print or retrieve the production updater private key.
- Actions binds the existing `TAURI_SIGNING_PRIVATE_KEY` and password secrets only to the build step.
- The public key in `src-tauri/tauri.conf.json` is the trust anchor for already-installed apps. Keep it unchanged.
- Verify every updater signature with minisign against that public key before publishing.
- Updater signing and OS signing are separate. This release is ad-hoc signed, **not Developer ID signed or notarized**. Gatekeeper warnings are possible.
- Test fixtures use disposable unrelated minisign keys; never production credentials.

## Required macOS assets

- `Orbit_<version>_aarch64.dmg`
- `Orbit_aarch64-apple-darwin.app.tar.gz`
- `Orbit_aarch64-apple-darwin.app.tar.gz.sig`
- `latest.json`
- `SHA256SUMS`
- `SIGNING-STATUS.txt`

The manifest must contain only `darwin-aarch64`, the exact release version, immutable download URLs for that tag and the actual signature sidecar contents. Never map an older Windows/Linux payload to a newer global manifest version. Intel Mac support is not implied.

Historical Windows/Linux installers remain on their own release pages. Old unsupported-platform clients may report no matching platform from this Mac-only feed; do not promise cross-platform automatic updates from it.

## Local gates

```sh
npm ci
npm test
npm run lint
npm run build
npm run test:release
npm audit --audit-level=high
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
actionlint .github/workflows/build.yml .github/workflows/release.yml
python3 scripts/release.py check-version --tag v1.2.1
```

Synchronize versions in package.json, both package-lock root entries, Cargo.toml, Orbit's Cargo.lock entry and tauri.conf.json before tagging. Review the exact staged files and retain source attribution/license. No temporary workspace data, credentials, screenshots of personal work or unreviewed sketches should enter the release commit.

## Verify a draft before authorized publication

Download into a new empty scratch directory and validate the actual bytes:

```sh
gh release view v1.2.1 -R imadAttar/orbit --json isDraft,assets,targetCommitish
gh release download v1.2.1 -R imadAttar/orbit --dir "$QA_DIR"
python3 scripts/release.py verify --output "$QA_DIR" --tag v1.2.1 --repo imadAttar/orbit --platforms macos-arm64
```

Check that Actions succeeded on the exact tag commit, verify the DMG/application version and ARM64 architecture, and read the changelog/signing warning. The helper rejects missing, extra or orphan assets, bad signatures, wrong versions/platforms/architectures/URLs and incomplete/tampered checksums.

After explicit publication, read the release back, fetch the **public** latest.json URL and updater payload, and reverify signatures and SHA256 over public downloads. Do not confuse a successful upload with publicly reachable assets. Do not install/relaunch the user's app merely to prove that an update exists.

## Update notifications

The configured endpoint remains:

`https://github.com/imadAttar/orbit/releases/latest/download/latest.json`

Publishing the verified stable release makes it discoverable to older compatible Mac clients on their existing checks (for old versions, typically the next launch). New periodic/re-entry behavior only applies after those clients upgrade to the new code. Respect each user's autoUpdate preference; never force a relaunch. A real installed-client download/install/permission/restart cycle is a separate native check, not established by fixture tests or by the public manifest alone.
