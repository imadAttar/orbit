"""Fail-closed Tauri release asset collection and verification (Python 3.11+)."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from urllib.parse import quote

PLATFORMS = {
    "macos-arm64": ("darwin-aarch64", ".app.tar.gz", (".dmg",)),
    "linux-x64": ("linux-x86_64", ".AppImage", (".AppImage", ".deb")),
    "windows-x64": ("windows-x86_64", ".msi", (".msi",)),
}


def collect(bundle, output, platform):
    """Copy only installers and updater payloads with mandatory signature sidecars."""
    _, updater, installers = PLATFORMS[platform]
    output.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in bundle.rglob("*") if p.is_file())
    payloads = [p for p in files if p.name.endswith(updater)]
    if len(payloads) != 1:
        raise ValueError(f"{platform}: expected exactly one {updater} payload")
    for source in files:
        if not source.name.endswith((*installers, updater)):
            continue
        name = "Orbit_aarch64-apple-darwin.app.tar.gz" if source.name.endswith(".app.tar.gz") else source.name
        destination = output / name
        if destination.exists():
            raise ValueError(f"Duplicate asset: {name}")
        shutil.copy2(source, destination)
        if source in payloads:
            signature = source.with_name(source.name + ".sig")
            if not signature.is_file() or not signature.read_text().strip():
                raise ValueError(f"Missing updater signature: {source.name}")
            shutil.copy2(signature, output / (name + ".sig"))


def version_number(tag):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("Expected stable release tag vMAJOR.MINOR.PATCH")
    return tag[1:]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_signature(payload, signature, pubkey):
    """Verify Tauri's base64-encoded minisign envelope against the existing public key."""
    with tempfile.TemporaryDirectory() as directory:
        signature_path = Path(directory) / "payload.minisig"
        key_path = Path(directory) / "updater.pub"
        signature_path.write_bytes(base64.b64decode(signature.strip(), validate=True))
        key_path.write_bytes(base64.b64decode(pubkey.strip(), validate=True))
        result = subprocess.run(["minisign", "-V", "-m", str(payload), "-x", str(signature_path), "-p", str(key_path)], capture_output=True)
        if result.returncode:
            raise ValueError(f"Invalid updater signature: {payload.name}")


def expected_assets(output, version, platforms=None):
    if isinstance(platforms, str):
        raise ValueError("Invalid platform selection: expected a sequence of platform names")
    platforms = tuple(PLATFORMS) if platforms is None else tuple(platforms)
    if not platforms or len(set(platforms)) != len(platforms) or any(p not in PLATFORMS for p in platforms):
        raise ValueError("Invalid platform selection: choose distinct supported platforms")
    selected = {}
    allowed = {"SIGNING-STATUS.txt", "latest.json", "SHA256SUMS"}
    for platform in platforms:
        key, suffix, installers = PLATFORMS[platform]
        for extension in set((*installers, suffix)):
            matches = [p for p in output.iterdir() if p.is_file() and p.name.endswith(extension)]
            if len(matches) != 1:
                raise ValueError(f"{key}: expected exactly one {extension}")
            payload = matches[0]
            if not payload.name.endswith(".app.tar.gz") and f"_{version}_" not in payload.name:
                raise ValueError(f"Version mismatch: {payload.name}")
            allowed.add(payload.name)
            if extension == suffix:
                selected[key] = payload
                allowed.add(payload.name + ".sig")
    if "macos-arm64" in platforms:
        if selected["darwin-aarch64"].name != "Orbit_aarch64-apple-darwin.app.tar.gz":
            raise ValueError("Incorrect macOS updater architecture/name")
        if next(output.glob("*.dmg")).name != f"Orbit_{version}_aarch64.dmg":
            raise ValueError("Incorrect macOS installer architecture")
    if "linux-x64" in platforms:
        for pattern in ("*.AppImage", "*.deb"):
            if "amd64" not in next(output.glob(pattern)).name:
                raise ValueError("Incorrect Linux architecture")
    if "windows-x64" in platforms and "x64" not in selected["windows-x86_64"].name:
        raise ValueError("Incorrect Windows architecture")
    for path in output.iterdir():
        if not path.is_file() or path.name not in allowed:
            raise ValueError(f"Unexpected asset: {path.name}")
        if path.stat().st_size == 0:
            raise ValueError(f"Empty asset: {path.name}")
    return selected


def checksum_text(output):
    return "".join(f"{digest(path)}  {path.name}\n" for path in sorted(output.iterdir()) if path.is_file() and path.name != "SHA256SUMS")


def verify(output, tag, repo, pubkey, platforms=None):
    version = version_number(tag)
    manifest = json.loads((output / "latest.json").read_text())
    selected = expected_assets(output, version, platforms)
    if manifest["version"] != version or set(manifest["platforms"]) != set(selected):
        raise ValueError("Manifest version or platforms mismatch")
    datetime.strptime(manifest["pub_date"], "%Y-%m-%dT%H:%M:%SZ")
    for platform, payload in selected.items():
        entry = manifest["platforms"][platform]
        signature = payload.with_name(payload.name + ".sig").read_text().strip()
        expected_url = f"https://github.com/{repo}/releases/download/{tag}/{quote(payload.name)}"
        if entry["signature"] != signature or entry["url"] != expected_url:
            raise ValueError(f"Manifest signature/URL mismatch: {platform}")
        verify_signature(payload, signature, pubkey)
    if (output / "SHA256SUMS").read_text() != checksum_text(output):
        raise ValueError("SHA256SUMS mismatch (content or coverage)")


def prepare(assets, output, tag, repo, pubkey, platforms=None):
    version = version_number(tag)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid GitHub repository")
    output.mkdir(parents=True, exist_ok=False)
    for path in sorted(assets.rglob("*")):
        if not path.is_file():
            continue
        if not re.fullmatch(r"[A-Za-z0-9_.+-]+", path.name):
            raise ValueError(f"Unsafe asset filename: {path.name}")
        if (output / path.name).exists():
            raise ValueError(f"Duplicate asset: {path.name}")
        if not path.name.endswith((".dmg", ".deb", ".AppImage", ".msi", ".app.tar.gz", ".sig")) and path.name != "SIGNING-STATUS.txt":
            raise ValueError(f"Unexpected asset: {path.name}")
        if path.stat().st_size == 0:
            raise ValueError(f"Empty asset: {path.name}")
        shutil.copy2(path, output / path.name)
    selected = expected_assets(output, version, platforms)
    manifest = {
        "version": version,
        "notes": f"See https://github.com/{repo}/releases/tag/{tag}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {},
    }
    for platform, payload in selected.items():
        signature = payload.with_name(payload.name + ".sig").read_text().strip()
        verify_signature(payload, signature, pubkey)
        manifest["platforms"][platform] = {
            "signature": signature,
            "url": f"https://github.com/{repo}/releases/download/{tag}/{quote(payload.name)}",
        }
    (output / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "SHA256SUMS").write_text(checksum_text(output))
    verify(output, tag, repo, pubkey, platforms)


def check_version(root, tag):
    import tomllib
    expected = version_number(tag)
    versions = [json.loads((root / path).read_text())["version"] for path in ("package.json", "package-lock.json", "src-tauri/tauri.conf.json")]
    lock = json.loads((root / "package-lock.json").read_text())
    versions.append(lock["packages"][""]["version"])
    versions.append(tomllib.loads((root / "src-tauri/Cargo.toml").read_text())["package"]["version"])
    cargo_lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
    orbit_packages = [p["version"] for p in cargo_lock["package"] if p["name"] == "orbit"]
    if len(orbit_packages) != 1:
        raise ValueError("Orbit package missing or duplicated in Cargo.lock")
    versions.extend(orbit_packages)
    if not all(version == expected for version in versions):
        raise ValueError(f"Tag/config versions differ: expected {expected}, got {versions}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["collect", "prepare", "verify", "check-version"])
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--platform", choices=PLATFORMS)
    parser.add_argument("--platforms", nargs="+", choices=PLATFORMS,
                        help="Release targets for prepare/verify (default: all platforms)")
    parser.add_argument("--tag")
    parser.add_argument("--repo", default="imadAttar/orbit")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        if args.command == "collect":
            collect(args.input, args.output, args.platform)
        elif args.command == "check-version":
            check_version(args.root, args.tag)
        else:
            pubkey = json.loads((args.root / "src-tauri/tauri.conf.json").read_text())["plugins"]["updater"]["pubkey"]
            if args.command == "prepare":
                prepare(args.input, args.output, args.tag, args.repo, pubkey, args.platforms)
            else:
                verify(args.output, args.tag, args.repo, pubkey, args.platforms)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"Release validation failed: {error}\n")
    print(f"Release {args.command}: OK")


if __name__ == "__main__":
    main()
