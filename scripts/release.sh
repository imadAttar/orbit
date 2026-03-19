#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh 0.2.0
# Builds locally, creates git tag, uploads GitHub release with artifacts.

REPO="imadAttar/orbit"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

VERSION="$1"
TAG="$VERSION"

echo "==> Release Orbit v${VERSION}"
echo ""

# 1. Check prerequisites
command -v gh >/dev/null || { echo "Error: gh CLI not installed"; exit 1; }
command -v cargo >/dev/null || { source "$HOME/.cargo/env" 2>/dev/null; }
command -v cargo >/dev/null || { echo "Error: cargo not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Error: gh not authenticated (run: gh auth login)"; exit 1; }

# 2. Bump version in all 3 files
echo "==> Bumping version to ${VERSION}"
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

# 3. Typecheck + tests
echo "==> Typecheck"
npx tsc --noEmit

echo "==> Tests"
npm test

# 4. Build Tauri (macOS ARM64 — native on this machine)
echo "==> Building Tauri app (macOS ARM64)..."
SIGNING_KEY_FILE="$HOME/.tauri/claude-ide.key"
if [ -f "$SIGNING_KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
fi
npm run tauri build -- --target aarch64-apple-darwin

# 5a. Sign updater artifact with minisign if Tauri didn't
BUNDLE_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"
TAR_GZ="$BUNDLE_DIR/macos/Orbit.app.tar.gz"
if [ -f "$TAR_GZ" ] && [ ! -f "$TAR_GZ.sig" ] && [ -f "$SIGNING_KEY_FILE" ]; then
  echo "==> Signing updater artifact with minisign"
  echo "" | minisign -S -s "$SIGNING_KEY_FILE" -m "$TAR_GZ" -W
fi

# 5. Collect artifacts
echo "==> Collecting artifacts"
rm -rf artifacts
mkdir -p artifacts

BUNDLE_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"
if [ -d "$BUNDLE_DIR" ]; then
  find "$BUNDLE_DIR" -type f \( -name "*.dmg" -o -name "*.tar.gz" -o -name "*.sig" \) -exec cp {} artifacts/ \;
fi

echo "   Artifacts:"
ls -lh artifacts/

# 6. Generate latest.json for auto-updater
echo "==> Generating latest.json"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

read_sig() {
  local pattern="$1"
  local sig_file
  sig_file=$(find artifacts -name "${pattern}.sig" 2>/dev/null | head -1)
  if [ -f "$sig_file" ]; then
    cat "$sig_file"
  else
    echo ""
  fi
}

find_artifact() {
  local pattern="$1"
  find artifacts -name "$pattern" ! -name "*.sig" 2>/dev/null | head -1 | xargs -I{} basename {}
}

MACOS_ARM64=$(find_artifact "*aarch64*.tar.gz")
MACOS_ARM64_SIG=$(read_sig "*aarch64*.tar.gz")

cat > artifacts/latest.json << EOF
{
  "version": "${VERSION}",
  "notes": "See release notes at https://github.com/${REPO}/releases/tag/${TAG}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${MACOS_ARM64_SIG}",
      "url": "${BASE_URL}/${MACOS_ARM64}"
    }
  }
}
EOF

echo "   latest.json:"
cat artifacts/latest.json

# 7. Git commit + tag
echo "==> Git commit + tag"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to ${VERSION}" || echo "   (no changes to commit)"
git tag -a "${TAG}" -m "v${VERSION}"

# 8. Push
echo "==> Pushing to origin"
git push origin main
git push origin "${TAG}"

# 9. Create GitHub Release
echo "==> Creating GitHub Release"
gh release create "${TAG}" \
  --repo "${REPO}" \
  --title "Orbit v${VERSION}" \
  --generate-notes \
  artifacts/*

echo ""
echo "==> Done! Release: https://github.com/${REPO}/releases/tag/${TAG}"
